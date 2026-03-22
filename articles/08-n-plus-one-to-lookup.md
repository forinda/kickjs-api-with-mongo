---
title: "From N+1 to $lookup in KickJS — Paginating Joined Data with MongoDB Aggregation Pipelines"
published: false
description: "How I replaced Promise.all N+1 queries with MongoDB $lookup aggregation pipelines in a Node.js task management backend, and how it changed the way I think about data fetching in document databases."
tags: kickjs, mongodb, nodejs, typescript, performance
canonical_url:
cover_image:
---

# From N+1 to $lookup — Paginating Joined Data in MongoDB Aggregation Pipelines

If you have ever built a relational-style API on top of MongoDB, you have probably written the same antipattern I did: fetch a list of IDs, then loop over them with `Promise.all` to hydrate each document individually. It works. It ships. And then it falls over the moment your dataset grows past a few hundred records.

I am going to walk through exactly how I found and fixed this in Vibed, a Jira-like task management backend built with TypeScript, Mongoose, and the KickJS framework. The transformation was surprisingly straightforward, and the performance difference was dramatic.

## The Setup: Workspaces and Members

Vibed has workspaces (think Slack teams or Jira organizations) and workspace members. A user can belong to multiple workspaces, and each workspace has many members. The relationship lives in a `workspace_members` join collection:

```typescript
// workspace-member.schema.ts
const workspaceMemberSchema = new Schema<WorkspaceMemberDocument>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

workspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
```

And a straightforward workspace schema:

```typescript
// workspace.schema.ts
const workspaceSchema = new Schema<WorkspaceDocument>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    description: { type: String, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    logoUrl: { type: String },
  },
  { timestamps: true },
);
```

Two collections. No embedding. Classic relational-in-document-DB design. Nothing wrong with that. The problem was how I queried them.

## The N+1 Problem: ListWorkspacesUseCase

Here is the original use case that powered the "list my workspaces" endpoint:

```typescript
// list-workspaces.use-case.ts (BEFORE)
@Service()
export class ListWorkspacesUseCase {
  constructor(
    @Inject(TOKENS.WORKSPACE_REPOSITORY) private workspaceRepo: IWorkspaceRepository,
    @Inject(TOKENS.WORKSPACE_MEMBER_REPOSITORY) private memberRepo: IWorkspaceMemberRepository,
  ) {}

  async execute(userId: string) {
    const memberships = await this.memberRepo.findByUser(userId);
    const workspaces = await Promise.all(
      memberships.map(async (m) => {
        const ws = await this.workspaceRepo.findById(m.workspaceId.toString());
        return ws ? { ...ws, role: m.role } : null;
      }),
    );
    return workspaces.filter(Boolean);
  }
}
```

Read that carefully. For a user who belongs to 30 workspaces, this issues:

1. **1 query** to fetch all membership records for the user
2. **30 queries** to fetch each workspace by ID

That is 31 round trips to MongoDB. For 100 workspaces, it is 101 round trips. This is the textbook N+1 problem.

The same pattern existed in `ListMembersUseCase`, which listed all members of a workspace:

```typescript
// list-members.use-case.ts (BEFORE)
@Service()
export class ListMembersUseCase {
  constructor(
    @Inject(TOKENS.WORKSPACE_MEMBER_REPOSITORY) private memberRepo: IWorkspaceMemberRepository,
    @Inject(TOKENS.USER_REPOSITORY) private userRepo: IUserRepository,
  ) {}

  async execute(workspaceId: string) {
    const members = await this.memberRepo.findByWorkspace(workspaceId);
    const enriched = await Promise.all(
      members.map(async (m) => {
        const user = await this.userRepo.findById(m.userId.toString());
        return {
          id: m._id.toString(),
          userId: m.userId.toString(),
          role: m.role,
          joinedAt: m.joinedAt,
          user: user
            ? {
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                avatarUrl: user.avatarUrl,
              }
            : null,
        };
      }),
    );
    return enriched;
  }
}
```

Same pattern. Fetch the join table, then hydrate each foreign key one at a time. A workspace with 50 members means 51 queries.

To make it worse, neither of these endpoints had pagination. They returned everything. A workspace with 200 members? Here is your 201-query, unpaginated JSON blob.

## The Fix: $lookup Aggregation Pipeline

MongoDB's `$lookup` stage is essentially a left outer join performed server-side in a single aggregation pipeline. Instead of fetching IDs and then round-tripping back for each document, you tell MongoDB to do the join for you.

Here is the replacement for listing a user's workspaces -- the `findPaginatedForUser` method on the repository:

```typescript
// mongo-workspace-member.repository.ts
async findPaginatedForUser(parsed: any, userId: string): Promise<{ data: any[]; total: number }> {
  const { filters = [], sort = [], pagination = { page: 1, limit: 20, offset: 0 } } = parsed;
  const matchStage = { userId: new mongoose.Types.ObjectId(userId), ...buildMongoFilter(filters) };
  const mongoSort = buildMongoSort(sort);

  const pipeline: any[] = [
    { $match: matchStage },
    { $lookup: {
      from: 'workspaces',
      localField: 'workspaceId',
      foreignField: '_id',
      as: 'workspace'
    }},
    { $unwind: '$workspace' },
    { $project: {
      _id: '$workspace._id',
      name: '$workspace.name',
      slug: '$workspace.slug',
      description: '$workspace.description',
      ownerId: '$workspace.ownerId',
      logoUrl: '$workspace.logoUrl',
      createdAt: '$workspace.createdAt',
      updatedAt: '$workspace.updatedAt',
      role: '$role',
    }},
    { $sort: mongoSort },
  ];

  const countPipeline = [...pipeline, { $count: 'total' }];
  const dataPipeline = [...pipeline, { $skip: pagination.offset }, { $limit: pagination.limit }];

  const [countResult, data] = await Promise.all([
    WorkspaceMemberModel.aggregate(countPipeline),
    WorkspaceMemberModel.aggregate(dataPipeline),
  ]);

  return { data, total: countResult[0]?.total ?? 0 };
}
```

Let me break down each stage.

### Stage 1: $match

```typescript
{ $match: matchStage }
```

This filters the `workspace_members` collection to only rows belonging to the current user. With the index on `userId`, this is an indexed scan. Any additional filters from query parameters (parsed by `buildMongoFilter`) are merged in here.

### Stage 2: $lookup

```typescript
{ $lookup: {
  from: 'workspaces',
  localField: 'workspaceId',
  foreignField: '_id',
  as: 'workspace'
}}
```

This is the join. For each membership document that survived the `$match`, MongoDB looks up the corresponding workspace by matching `workspaceId` to `_id` in the `workspaces` collection. The result is an array (since `$lookup` always produces an array), stored in a field called `workspace`.

### Stage 3: $unwind

```typescript
{ $unwind: '$workspace' }
```

Since `$lookup` produces an array, `$unwind` flattens it. Because the relationship is many-to-one (each membership has exactly one workspace), the array always has zero or one element. `$unwind` also implicitly filters out memberships where the workspace was deleted -- if the `workspace` array is empty, the document is dropped.

### Stage 4: $project

```typescript
{ $project: {
  _id: '$workspace._id',
  name: '$workspace.name',
  slug: '$workspace.slug',
  description: '$workspace.description',
  ownerId: '$workspace.ownerId',
  logoUrl: '$workspace.logoUrl',
  createdAt: '$workspace.createdAt',
  updatedAt: '$workspace.updatedAt',
  role: '$role',
}}
```

This reshapes the output so the API consumer sees workspace fields at the top level, with the user's `role` attached. Without this stage, the response would have the raw membership document structure with a nested `workspace` object. The `$project` stage lets you control exactly what the client receives.

### Stage 5: Pagination

```typescript
const countPipeline = [...pipeline, { $count: 'total' }];
const dataPipeline = [...pipeline, { $skip: pagination.offset }, { $limit: pagination.limit }];

const [countResult, data] = await Promise.all([
  WorkspaceMemberModel.aggregate(countPipeline),
  WorkspaceMemberModel.aggregate(dataPipeline),
]);
```

Two parallel aggregation queries: one counts the total (for pagination metadata), the other fetches the current page. Running them in parallel with `Promise.all` keeps latency low.

## The Members Endpoint: $lookup in the Other Direction

The same pattern works for listing workspace members, but the `$lookup` joins against the `users` collection instead:

```typescript
async findPaginatedMembers(parsed: any, workspaceId: string): Promise<{ data: any[]; total: number }> {
  const { filters = [], sort = [], pagination = { page: 1, limit: 20, offset: 0 } } = parsed;
  const matchStage = {
    workspaceId: new mongoose.Types.ObjectId(workspaceId),
    ...buildMongoFilter(filters)
  };
  const mongoSort = buildMongoSort(sort);

  const pipeline: any[] = [
    { $match: matchStage },
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $project: {
      _id: 1,
      userId: 1,
      role: 1,
      joinedAt: 1,
      user: {
        email: '$user.email',
        firstName: '$user.firstName',
        lastName: '$user.lastName',
        avatarUrl: '$user.avatarUrl',
      },
    }},
    { $sort: mongoSort },
  ];

  const countPipeline = [...pipeline, { $count: 'total' }];
  const dataPipeline = [...pipeline, { $skip: pagination.offset }, { $limit: pagination.limit }];

  const [countResult, data] = await Promise.all([
    WorkspaceMemberModel.aggregate(countPipeline),
    WorkspaceMemberModel.aggregate(dataPipeline),
  ]);

  return { data, total: countResult[0]?.total ?? 0 };
}
```

Notice how the `$project` stage here selectively picks user fields. I do not return `passwordHash`, `globalRole`, or `isActive` -- only what the frontend needs. This is a security win that you get for free with `$project`.

## Before and After: Side by Side

Here is the contrast in the controller. Before, the list endpoint called a use case that did N+1:

```typescript
// BEFORE: Use case with N+1 queries
@Get('/')
async list(ctx: RequestContext) {
  const user = getUser(ctx);
  const workspaces = await this.listWorkspacesUseCase.execute(user.id);
  ctx.json(successResponse(workspaces));
}
```

After, the controller uses `ctx.paginate()` with the repository's aggregation method:

```typescript
// AFTER: Single aggregation pipeline + pagination
@Get('/')
@ApiQueryParams(WORKSPACE_QUERY_CONFIG)
async list(ctx: RequestContext) {
  const user = getUser(ctx);
  await ctx.paginate(
    (parsed) => this.memberRepo.findPaginatedForUser(parsed, user.id),
    WORKSPACE_QUERY_CONFIG,
  );
}
```

The use case class is no longer needed for the list endpoint. The repository handles the join and pagination in one shot, and `ctx.paginate()` handles the response envelope.

## Performance: What Changed

The numbers speak for themselves. For a user with 50 workspace memberships:

| Metric | N+1 (Before) | $lookup (After) |
|--------|-------------|-----------------|
| MongoDB round trips | 51 | 2 |
| Network overhead | 51 separate TCP exchanges | 2 aggregation pipelines |
| Pagination | None (returns all) | Server-side $skip/$limit |
| Data shaping | Application code | $project in pipeline |
| Memory usage | All docs loaded in Node.js | Only current page loaded |

The two remaining round trips are the count pipeline and the data pipeline, and they run in parallel. Even those could be reduced to one with `$facet`, but the parallel approach is simpler to read and maintains negligible overhead.

## Gotchas I Ran Into

### 1. ObjectId Conversion

The `$match` stage needs actual `ObjectId` instances, not strings:

```typescript
// Wrong -- won't match anything
const matchStage = { userId: userId };

// Right
const matchStage = { userId: new mongoose.Types.ObjectId(userId) };
```

When you use Mongoose's `find()`, it auto-converts strings to ObjectIds. Aggregation pipelines do not. This tripped me up for an embarrassing amount of time.

### 2. $unwind Drops Orphans

If a membership references a deleted workspace, `$unwind` silently drops it. This is actually what I wanted -- no point returning a membership for a workspace that no longer exists. But if you need to preserve orphans (for an admin dashboard, say), use `{ preserveNullAndEmptyArrays: true }`.

### 3. Index Your $lookup Fields

The `$lookup` stage performs a collection scan on the `from` collection unless the `foreignField` is indexed. For `$lookup` on `workspaces` by `_id`, this is free (MongoDB always indexes `_id`). But if you are looking up by a non-`_id` field, make sure it is indexed.

### 4. Collection Names Are Lowercase Plural

The `from` field in `$lookup` uses the actual MongoDB collection name, not the Mongoose model name. Mongoose lowercases and pluralizes by default: model `'User'` becomes collection `'users'`, model `'Workspace'` becomes `'workspaces'`. Get this wrong and the `$lookup` silently returns empty arrays.

## When to Use $lookup vs. Mongoose populate()

Mongoose `populate()` is syntactically simpler but has the same N+1 problem under the hood -- it issues separate queries for each referenced collection. Use `$lookup` when:

- You need server-side pagination of the joined result
- You want to filter or sort by fields from the joined collection
- You need to reshape the output with `$project`
- Performance matters (it always does, eventually)

Use `populate()` when you are fetching a single document and need one or two referenced fields. For list endpoints, `$lookup` wins every time.

## Takeaway

The N+1 problem is not unique to SQL ORMs. It shows up in MongoDB the moment you model relationships with references instead of embedding. The fix is the same conceptual move as a SQL JOIN: push the work to the database. MongoDB's aggregation pipeline gives you `$lookup` for joining, `$project` for shaping, and `$skip`/`$limit` for pagination -- all in a single server-side operation.

The refactor took about an hour per endpoint. The hardest part was getting the `$project` shapes right so existing frontend consumers did not break. The performance improvement was immediate and significant, especially for workspaces with dozens of members and users belonging to many workspaces.

If you have `Promise.all` + `findById` loops in your codebase, go find them. Replace them with `$lookup`. Your database will thank you.
