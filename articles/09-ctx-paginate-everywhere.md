---
title: "KickJS ctx.paginate() Everywhere: Standardizing Pagination Across 10+ Endpoints"
published: false
description: "How I used KickJS's ctx.paginate() method to bring consistent pagination, filtering, sorting, and search to every list endpoint in a task management backend -- and how centralized query configs kept Swagger docs in sync automatically."
tags: kickjs, nodejs, typescript, api, pagination
canonical_url:
cover_image:
---

# ctx.paginate() Everywhere: Standardizing Pagination Across 10+ Endpoints

Every backend eventually hits the same wall: your list endpoints are inconsistent. Some return paginated results. Some dump the entire collection. Some support sorting, others do not. The response shapes differ between endpoints. Your frontend developers have to special-case every list call.

I hit this wall on Vibed, a Jira-like task management backend with over a dozen resource types: tasks, projects, workspaces, channels, labels, comments, attachments, notifications, activity logs, workspace members, and more. Each one needed a list endpoint. Each one needed pagination, filtering, and sorting. I needed a single pattern that I could stamp out consistently.

The answer turned out to be three things working together: KickJS's `ctx.paginate()` method, centralized query config objects, and a `findPaginated` repository pattern backed by shared MongoDB query helpers.

## The Problem: Inconsistent List Endpoints

Here is what some of the early list endpoints looked like before standardization:

```typescript
// Tasks: manual pagination with ctx.qs()
async list(ctx: RequestContext) {
  const qs = ctx.qs();
  const tasks = await this.taskRepo.find({ projectId: ctx.params.projectId })
    .skip(qs.offset).limit(qs.limit);
  ctx.json({ data: tasks });
}

// Labels: no pagination at all
async list(ctx: RequestContext) {
  const labels = await this.labelRepo.findByWorkspace(ctx.params.workspaceId);
  ctx.json(successResponse(labels));
}

// Members: no pagination, N+1 hydration
async listMembers(ctx: RequestContext) {
  const members = await this.listMembersUseCase.execute(ctx.params.workspaceId);
  ctx.json(successResponse(members));
}
```

Three endpoints, three different approaches. None of them returned pagination metadata. None of them supported filtering or sorting through query parameters. The frontend had to know which endpoints were paginated and which were not.

## The Solution: ctx.paginate(fetcher, config)

KickJS provides a `ctx.paginate()` method that handles the entire pagination lifecycle. You give it a data-fetching function and a configuration object. It parses query parameters, calls your fetcher, and sends a standardized response.

Here is what every list endpoint looks like now:

```typescript
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

Three lines of actual logic. The `parsed` argument that your fetcher receives contains everything extracted from the query string: filters, sort directives, search terms, and pagination parameters. Your repository uses these to build the database query. `ctx.paginate()` handles the response envelope.

## Query Configs: The Single Source of Truth

The config object defines what fields can be filtered, sorted, and searched. I centralized all of them in one file:

```typescript
// src/shared/constants/query-configs.ts
import type { ApiQueryParamsConfig } from "@forinda/kickjs-core";

export const TASK_QUERY_CONFIG: ApiQueryParamsConfig = {
  filterable: ['status', 'priority', 'assigneeId', 'labelId', 'projectId'],
  sortable: ['createdAt', 'title', 'priority', 'dueDate', 'orderIndex'],
  searchable: ['title', 'description'],
};

export const LABEL_QUERY_CONFIG: ApiQueryParamsConfig = {
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
};

export const CHANNEL_QUERY_CONFIG: ApiQueryParamsConfig = {
  sortable: ['name', 'createdAt'],
  searchable: ['name', 'description'],
};

export const WORKSPACE_QUERY_CONFIG: ApiQueryParamsConfig = {
  sortable: ['name', 'createdAt'],
  searchable: ['name', 'description'],
};

export const PROJECT_QUERY_CONFIG: ApiQueryParamsConfig = {
  sortable: ['name', 'createdAt', 'key'],
  searchable: ['name', 'description', 'key'],
};

export const COMMENT_QUERY_CONFIG: ApiQueryParamsConfig = {
  sortable: ['createdAt'],
};

export const ATTACHMENT_QUERY_CONFIG: ApiQueryParamsConfig = {
  sortable: ['createdAt', 'fileName'],
  searchable: ['fileName'],
};

export const NOTIFICATION_QUERY_CONFIG: ApiQueryParamsConfig = {
  filterable: ['type', 'isRead'],
  sortable: ['createdAt'],
};

export const MEMBER_QUERY_CONFIG: ApiQueryParamsConfig = {
  filterable: ['role'],
  sortable: ['joinedAt'],
};
```

Each config serves double duty. First, `ctx.paginate()` uses it to parse and validate query parameters -- if someone tries to sort by a field not in `sortable`, it gets ignored. Second, the `@ApiQueryParams()` decorator reads the same config to generate Swagger documentation. One object, two consumers, always in sync.

## The Consistent Response Shape

Every paginated endpoint returns exactly this structure:

```json
{
  "data": [
    { "_id": "...", "name": "Engineering", "slug": "engineering", "role": "admin" },
    { "_id": "...", "name": "Design", "slug": "design", "role": "member" }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 47,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  }
}
```

The `meta` object gives frontends everything they need for pagination UI: current page, items per page, total count, total pages, and boolean flags for whether next/previous pages exist. This is the same shape whether you are listing tasks, labels, notifications, or workspace members. Frontend pagination components can be fully generic.

## The findPaginated Repository Pattern

Each repository implements a `findPaginated` method that accepts the parsed query object and returns `{ data, total }`. Here is the pattern for a simple collection like labels:

```typescript
// mongo-label.repository.ts
@Repository()
export class MongoLabelRepository implements ILabelRepository {
  async findPaginated(
    parsed: any,
    extraFilter: Record<string, any> = {}
  ): Promise<{ data: any[]; total: number }> {
    const {
      filters = [],
      sort = [],
      pagination = { page: 1, limit: 20, offset: 0 },
      search = ''
    } = parsed;

    const mongoFilter = {
      ...extraFilter,
      ...buildMongoFilter(filters),
      ...buildMongoSearch(search)
    };
    const mongoSort = buildMongoSort(sort);

    const [data, total] = await Promise.all([
      LabelModel.find(mongoFilter)
        .sort(mongoSort)
        .skip(pagination.offset)
        .limit(pagination.limit)
        .lean(),
      LabelModel.countDocuments(mongoFilter),
    ]);

    return { data: data as any[], total };
  }
}
```

The `extraFilter` parameter is how scope gets injected. When listing labels for a workspace, the controller passes `{ workspaceId: ctx.params.workspaceId }`. The repository merges it with any user-supplied filters.

## The Query Helpers: buildMongoFilter, buildMongoSort, buildMongoSearch

Three small functions translate the parsed query into Mongoose-compatible objects:

```typescript
// src/shared/infrastructure/database/query-helpers.ts

export function buildMongoFilter(
  filters: Array<{ field: string; operator: string; value: string }>
): Record<string, any> {
  const mongoFilter: Record<string, any> = {};
  for (const { field, operator, value } of filters) {
    switch (operator) {
      case 'eq':
        mongoFilter[field] = value;
        break;
      case 'neq':
        mongoFilter[field] = { $ne: value };
        break;
      case 'gt':
        mongoFilter[field] = { $gt: value };
        break;
      case 'gte':
        mongoFilter[field] = { $gte: value };
        break;
      case 'lt':
        mongoFilter[field] = { $lt: value };
        break;
      case 'lte':
        mongoFilter[field] = { $lte: value };
        break;
      case 'in':
        mongoFilter[field] = { $in: value.split(',') };
        break;
      case 'contains':
        mongoFilter[field] = { $regex: value, $options: 'i' };
        break;
      case 'starts':
        mongoFilter[field] = { $regex: `^${value}`, $options: 'i' };
        break;
      case 'ends':
        mongoFilter[field] = { $regex: `${value}$`, $options: 'i' };
        break;
      default:
        mongoFilter[field] = value;
    }
  }
  return mongoFilter;
}

export function buildMongoSort(
  sort: Array<{ field: string; direction: 'asc' | 'desc' }>
): Record<string, 1 | -1> {
  const mongoSort: Record<string, 1 | -1> = {};
  for (const { field, direction } of sort) {
    mongoSort[field] = direction === 'asc' ? 1 : -1;
  }
  if (Object.keys(mongoSort).length === 0) {
    mongoSort.createdAt = -1; // default: newest first
  }
  return mongoSort;
}

export function buildMongoSearch(search: string): Record<string, any> {
  if (!search) return {};
  return { $text: { $search: search } };
}
```

These helpers are stateless and composable. `buildMongoFilter` maps KickJS filter operators (`eq`, `neq`, `gt`, `in`, `contains`, etc.) to MongoDB query operators. `buildMongoSort` converts sort directives to Mongoose sort objects, defaulting to `createdAt: -1` when no sort is specified. `buildMongoSearch` wraps the search string in a MongoDB `$text` query, which leverages text indexes defined on the schemas.

## Rolling It Out: Endpoint by Endpoint

Here is how `ctx.paginate()` looks across different resources. The pattern is identical -- only the repository method and config change.

### Tasks

```typescript
@Get('/projects/:projectId/tasks', { params: z.object({ projectId: z.string() }) })
@Middleware(projectAccessGuard)
@ApiQueryParams(TASK_QUERY_CONFIG)
async list(ctx: RequestContext) {
  await ctx.paginate(
    async (parsed) => {
      parsed.filters.push({ field: 'projectId', operator: 'eq', value: ctx.params.projectId });
      return this.taskRepo.findPaginated(parsed);
    },
    TASK_QUERY_CONFIG,
  );
}
```

Notice how the `projectId` scope is injected by pushing a filter into the parsed object. This is an alternative to the `extraFilter` parameter -- either approach works.

### Channels

```typescript
@Get('/workspaces/:workspaceId/channels', { params: z.object({ workspaceId: z.string() }) })
@Middleware(workspaceMembershipGuard)
@ApiQueryParams(CHANNEL_QUERY_CONFIG)
async list(ctx: RequestContext) {
  await ctx.paginate(
    (parsed) => this.channelRepo.findPaginated(parsed, { workspaceId: ctx.params.workspaceId }),
    CHANNEL_QUERY_CONFIG,
  );
}
```

### Workspace Members (with $lookup)

```typescript
@Get('/:workspaceId/members', { params: z.object({ workspaceId: z.string() }) })
@Middleware(workspaceMembershipGuard)
@ApiQueryParams(MEMBER_QUERY_CONFIG)
async listMembers(ctx: RequestContext) {
  await ctx.paginate(
    (parsed) => this.memberRepo.findPaginatedMembers(parsed, ctx.params.workspaceId),
    MEMBER_QUERY_CONFIG,
  );
}
```

Even the `$lookup`-based aggregation pipelines plug in seamlessly. The fetcher contract is the same: accept parsed query parameters, return `{ data, total }`.

### User's Workspaces (with $lookup)

```typescript
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

## Swagger Docs Stay in Sync

The `@ApiQueryParams` decorator reads the same config object that `ctx.paginate()` uses:

```typescript
@ApiQueryParams(TASK_QUERY_CONFIG)
```

This generates Swagger query parameter documentation showing:
- Which fields can be filtered (and with which operators)
- Which fields can be sorted
- Which fields support text search
- The `page` and `limit` parameters with their defaults

When I add a new filterable field to `TASK_QUERY_CONFIG`, the Swagger docs update automatically the next time the server starts. There is no separate OpenAPI spec to maintain.

## What the Frontend Sees

A request like this:

```
GET /api/v1/projects/abc123/tasks?filter[status]=eq:in-progress&sort=priority:desc&search=auth&page=2&limit=10
```

Returns:

```json
{
  "data": [
    {
      "_id": "674a1...",
      "key": "VIB-42",
      "title": "Fix auth token refresh",
      "status": "in-progress",
      "priority": "high",
      "createdAt": "2026-03-15T10:30:00.000Z"
    }
  ],
  "meta": {
    "page": 2,
    "limit": 10,
    "total": 15,
    "totalPages": 2,
    "hasNext": false,
    "hasPrev": true
  }
}
```

Every list endpoint in the API returns this same envelope. The frontend team wrote one pagination hook and reused it everywhere.

## The Checklist for Adding Pagination to a New Resource

After rolling this pattern across all modules, I distilled it to a repeatable checklist:

1. **Define the query config** in `shared/constants/query-configs.ts` -- what fields are filterable, sortable, searchable.

2. **Add `findPaginated` to the repository** -- destructure `parsed` into filters/sort/pagination/search, use the three `buildMongo*` helpers, return `{ data, total }`.

3. **Update the controller** -- replace the list method body with `await ctx.paginate(fetcher, CONFIG)`.

4. **Add the Swagger decorator** -- `@ApiQueryParams(CONFIG)` on the method.

That is four steps. Each one is mechanical. I converted all ten list endpoints in a single afternoon.

## Edge Cases and Lessons Learned

**Default sort matters.** If the client sends no `sort` parameter, `buildMongoSort` falls back to `createdAt: -1` (newest first). This is a sensible default for most resources. For tasks, you might prefer `orderIndex: 1` within a Kanban board -- handle that in the fetcher before calling the repository.

**Text search requires text indexes.** The `buildMongoSearch` helper uses MongoDB's `$text` operator, which requires a text index on the searchable fields. Without it, the query throws. Every schema that has `searchable` fields in its config needs a corresponding text index:

```typescript
taskSchema.index({ title: 'text', description: 'text' });
userSchema.index({ firstName: 'text', lastName: 'text', email: 'text' });
```

**extraFilter vs. pushed filters.** Both work. I prefer `extraFilter` for static scopes (like `workspaceId`) and pushed filters for dynamic scopes. The key is that scope filters should not be overridable by query parameters -- always merge them in a way that the client cannot bypass.

**The count query can be expensive.** For large collections, `countDocuments` with complex filters can be slow. Consider caching the total count or using `estimatedDocumentCount` for unfiltered counts. For Vibed's scale (thousands of documents, not millions), this has not been an issue.

## Takeaway

The combination of `ctx.paginate()`, centralized query configs, and a standard `findPaginated` repository method gave me three things that matter:

1. **Consistency** -- every list endpoint returns the same response shape with the same pagination metadata.
2. **Discoverability** -- Swagger docs automatically reflect what each endpoint supports.
3. **Velocity** -- adding pagination to a new resource takes fifteen minutes, not an afternoon.

If you are building an API with more than a handful of list endpoints, invest in a pagination pattern early. The upfront cost is small. The accumulated savings across ten, twenty, fifty endpoints are enormous.
