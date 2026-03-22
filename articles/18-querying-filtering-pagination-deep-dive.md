---
title: "KickJS Query Engine Deep Dive: Filtering, Sorting, Search, and Pagination with MongoDB"
description: "How we built a full-featured querying system in KickJS — from URL query strings to MongoDB queries — with filter operators, text search, configurable sorting, and standardized pagination across 10+ endpoints."
tags: ["kickjs", "mongodb", "typescript", "nodejs", "api"]
published: false
---

# KickJS Query Engine Deep Dive: Filtering, Sorting, Search, and Pagination with MongoDB

When you're building an API with 60+ endpoints and 10+ list views, you can't afford inconsistency. Some endpoints return everything. Some paginate but don't filter. Some sort by `createdAt`, others by `name`, and the client has no idea which is which.

We solved this in Vibed — a Jira-like task management backend — by building a querying pipeline that flows from URL query strings, through KickJS's `ctx.paginate()`, into MongoDB helpers, and back out as a standardized paginated response. Every list endpoint works the same way.

Here's how the full pipeline works.

---

## The Query Pipeline

```
Client request
  GET /api/v1/projects/abc/tasks?status=eq:open&priority=in:high,critical&sort=-dueDate&search=login&page=2&limit=10
       │
       ▼
  ctx.paginate(fetcher, TASK_QUERY_CONFIG)
       │
       ├── ctx.qs(config) parses the query string
       │   → filters: [{ field: 'status', operator: 'eq', value: 'open' }, ...]
       │   → sort: [{ field: 'dueDate', direction: 'desc' }]
       │   → search: 'login'
       │   → pagination: { page: 2, limit: 10, offset: 10 }
       │
       ▼
  fetcher(parsed) → repository.findPaginated(parsed)
       │
       ├── buildMongoFilter(filters) → { status: 'open', priority: { $in: ['high', 'critical'] } }
       ├── buildMongoSort(sort)      → { dueDate: -1 }
       ├── buildMongoSearch(search)  → { $text: { $search: 'login' } }
       │
       ▼
  MongoDB: Model.find(filter).sort(sort).skip(10).limit(10) + countDocuments(filter)
       │
       ▼
  Response: { data: [...], meta: { page: 2, limit: 10, total: 47, totalPages: 5, hasNext: true, hasPrev: true } }
```

One pipeline. Every endpoint. Let's break down each layer.

---

## Layer 1: Query Configs

The foundation is a centralized config file that declares what each endpoint supports:

```typescript
// src/shared/constants/query-configs.ts
import type { ApiQueryParamsConfig } from '@forinda/kickjs-core';

export const TASK_QUERY_CONFIG: ApiQueryParamsConfig = {
  filterable: ['status', 'priority', 'assigneeId', 'labelId', 'projectId'],
  sortable: ['createdAt', 'title', 'priority', 'dueDate', 'orderIndex'],
  searchable: ['title', 'description'],
};

export const WORKSPACE_QUERY_CONFIG: ApiQueryParamsConfig = {
  sortable: ['name', 'createdAt'],
  searchable: ['name', 'description'],
};

export const NOTIFICATION_QUERY_CONFIG: ApiQueryParamsConfig = {
  filterable: ['type', 'isRead'],
  sortable: ['createdAt'],
};
```

Each config serves **three purposes**:
1. **Runtime parsing** — `ctx.qs(config)` only parses fields listed here, ignoring anything else
2. **Swagger docs** — `@ApiQueryParams(config)` generates query parameter documentation automatically
3. **Validation** — prevents clients from filtering or sorting on fields you haven't whitelisted

We defined 11 configs for our endpoints: tasks, users, notifications, activity, labels, channels, workspaces, projects, comments, attachments, and members.

---

## Layer 2: The Controller

The controller is where it all comes together — one decorator and one method call:

```typescript
@Get('/projects/:projectId/tasks', {
  params: z.object({ projectId: z.string() }),
})
@Middleware(projectAccessGuard)
@ApiQueryParams(TASK_QUERY_CONFIG)
async list(ctx: RequestContext) {
  await ctx.paginate(
    async (parsed) => {
      // Inject the projectId as an additional filter
      parsed.filters.push({
        field: 'projectId',
        operator: 'eq',
        value: ctx.params.projectId,
      });
      return this.taskRepo.findPaginated(parsed);
    },
    TASK_QUERY_CONFIG,
  );
}
```

`ctx.paginate()` does everything:
1. Calls `ctx.qs(config)` internally to parse the query string
2. Passes the parsed result to your fetcher function
3. Wraps the `{ data, total }` response with pagination metadata
4. Sends the JSON response

You never call `ctx.qs()` separately. You never manually build the response envelope. You just return `{ data, total }` from the fetcher.

### Injecting extra filters

Notice `parsed.filters.push()` — this is how you scope queries to a parent resource. The URL already has `?status=eq:open`, and we add `projectId` programmatically. Both end up in the same MongoDB filter.

For simpler cases, you can pass the scope filter directly:

```typescript
// Labels scoped to a workspace
async list(ctx: RequestContext) {
  await ctx.paginate(
    (parsed) => this.labelRepo.findPaginated(parsed, {
      workspaceId: ctx.params.workspaceId,
    }),
    LABEL_QUERY_CONFIG,
  );
}
```

---

## Layer 3: The MongoDB Helpers

Three small functions translate the parsed query into MongoDB operations.

### buildMongoFilter — 10 operators

```typescript
export function buildMongoFilter(
  filters: Array<{ field: string; operator: string; value: string }>
): Record<string, any> {
  const mongoFilter: Record<string, any> = {};

  for (const { field, operator, value } of filters) {
    switch (operator) {
      case 'eq':       mongoFilter[field] = value; break;
      case 'neq':      mongoFilter[field] = { $ne: value }; break;
      case 'gt':       mongoFilter[field] = { $gt: value }; break;
      case 'gte':      mongoFilter[field] = { $gte: value }; break;
      case 'lt':       mongoFilter[field] = { $lt: value }; break;
      case 'lte':      mongoFilter[field] = { $lte: value }; break;
      case 'between': {
        const [min, max] = value.split(',');
        mongoFilter[field] = { $gte: min, $lte: max };
        break;
      }
      case 'in':       mongoFilter[field] = { $in: value.split(',') }; break;
      case 'contains': mongoFilter[field] = { $regex: value, $options: 'i' }; break;
      case 'starts':   mongoFilter[field] = { $regex: `^${value}`, $options: 'i' }; break;
      case 'ends':     mongoFilter[field] = { $regex: `${value}$`, $options: 'i' }; break;
      default:         mongoFilter[field] = value;
    }
  }

  return mongoFilter;
}
```

The URL syntax is `field=operator:value`:
- `?status=eq:open` → `{ status: 'open' }`
- `?priority=in:high,critical` → `{ priority: { $in: ['high', 'critical'] } }`
- `?dueDate=lte:2026-04-01` → `{ dueDate: { $lte: '2026-04-01' } }`
- `?title=contains:auth` → `{ title: { $regex: 'auth', $options: 'i' } }`
- `?points=between:3,8` → `{ points: { $gte: '3', $lte: '8' } }`

### buildMongoSort — with default fallback

```typescript
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
```

URL syntax: `?sort=-dueDate,title` → `{ dueDate: -1, title: 1 }`. Prefix `-` means descending.

### buildMongoSearch — full-text search

```typescript
export function buildMongoSearch(search: string): Record<string, any> {
  if (!search) return {};
  return { $text: { $search: search } };
}
```

Uses MongoDB's `$text` operator, which requires a text index on the schema:

```typescript
taskSchema.index({ title: 'text', description: 'text' });
userSchema.index({ firstName: 'text', lastName: 'text', email: 'text' });
```

URL: `?search=authentication` searches across all indexed text fields.

---

## Layer 4: The Repository

The `findPaginated` method brings it all together:

```typescript
async findPaginated(
  parsed: any,
  extraFilter: Record<string, any> = {},
): Promise<{ data: TaskEntity[]; total: number }> {
  const {
    filters = [],
    sort = [],
    pagination = { page: 1, limit: 20, offset: 0 },
    search = '',
  } = parsed;

  const mongoFilter = {
    ...extraFilter,
    ...buildMongoFilter(filters),
    ...buildMongoSearch(search),
  };
  const mongoSort = buildMongoSort(sort);

  const [data, total] = await Promise.all([
    TaskModel.find(mongoFilter)
      .sort(mongoSort)
      .skip(pagination.offset)
      .limit(pagination.limit)
      .lean(),
    TaskModel.countDocuments(mongoFilter),
  ]);

  return { data: data as any[], total };
}
```

Key details:
- **`extraFilter`** merges with parsed filters — used for scoping (e.g., `{ workspaceId }`)
- **`Promise.all`** runs the data query and count query in parallel
- **`.lean()`** returns plain objects instead of Mongoose documents (faster, smaller)
- Returns `{ data, total }` — that's the contract `ctx.paginate()` expects

### For aggregation pipelines ($lookup)

When you need joins — like listing workspaces with the user's role — use aggregation instead:

```typescript
async findPaginatedForUser(parsed: any, userId: string) {
  const { filters = [], sort = [], pagination = { ... } } = parsed;
  const matchStage = {
    userId: new mongoose.Types.ObjectId(userId),
    ...buildMongoFilter(filters),
  };
  const mongoSort = buildMongoSort(sort);

  const pipeline = [
    { $match: matchStage },
    { $lookup: {
      from: 'workspaces',
      localField: 'workspaceId',
      foreignField: '_id',
      as: 'workspace',
    }},
    { $unwind: '$workspace' },
    { $project: {
      _id: '$workspace._id',
      name: '$workspace.name',
      slug: '$workspace.slug',
      role: '$role',
      createdAt: '$workspace.createdAt',
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

Same `{ data, total }` contract. `ctx.paginate()` doesn't care whether you used `find()` or `aggregate()`.

---

## The Response Shape

Every paginated endpoint returns the same structure:

```json
{
  "data": [
    { "_id": "abc", "title": "Fix login bug", "status": "open", "priority": "high" },
    { "_id": "def", "title": "Add dark mode", "status": "todo", "priority": "medium" }
  ],
  "meta": {
    "page": 2,
    "limit": 10,
    "total": 47,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": true
  }
}
```

Frontend developers love this. They get `hasNext`/`hasPrev` for pagination controls, `total` for "showing 11-20 of 47 results", and `totalPages` for page number navigation. No guessing.

---

## Real API Examples

Here are actual queries you can make against the Vibed API:

```bash
# Tasks in a project, filtered by status and priority, sorted by due date
GET /api/v1/projects/abc/tasks?status=eq:in-progress&priority=in:high,critical&sort=-dueDate&limit=5

# Search tasks by title/description
GET /api/v1/projects/abc/tasks?search=authentication&sort=-createdAt

# Labels in a workspace, sorted alphabetically
GET /api/v1/workspaces/xyz/labels?sort=name&limit=50

# Workspace members filtered by role
GET /api/v1/workspaces/xyz/members?role=eq:admin&sort=-joinedAt

# Notifications, unread only, newest first
GET /api/v1/notifications?isRead=eq:false&sort=-createdAt&page=1&limit=20

# Activity feed for a project, filtered by action type
GET /api/v1/projects/abc/activity?action=eq:task.created&sort=-createdAt
```

All return the same `{ data, meta }` shape. All support the same filter operators.

---

## Adding a New Paginated Endpoint

The process is mechanical — about 5 minutes per endpoint:

1. **Define the query config** in `query-configs.ts`:
```typescript
export const INVOICE_QUERY_CONFIG: ApiQueryParamsConfig = {
  filterable: ['status', 'clientId', 'dueDate'],
  sortable: ['createdAt', 'amount', 'dueDate'],
  searchable: ['number', 'clientName'],
};
```

2. **Add `findPaginated` to the repository** (copy-paste the pattern, change the model name)

3. **Update the controller**:
```typescript
@ApiQueryParams(INVOICE_QUERY_CONFIG)
async list(ctx: RequestContext) {
  await ctx.paginate(
    (parsed) => this.invoiceRepo.findPaginated(parsed, { workspaceId: ctx.params.workspaceId }),
    INVOICE_QUERY_CONFIG,
  );
}
```

That's it. Swagger docs, query parsing, filtering, sorting, search, pagination — all handled.

---

## What We'd Change

A few things that could be better:

1. **Type the `parsed` parameter** — right now it's `any`. A `ParsedQuery` type from KickJS would make the contract explicit.

2. **Date coercion** — `buildMongoFilter` passes values as strings. Date fields like `dueDate=lte:2026-04-01` should be coerced to `Date` objects. We handle this per-field in some repos but it should be generic.

3. **Aggregation helper** — The `findPaginated` pattern for `$lookup` pipelines is more boilerplate than the simple `find()` version. A `buildPaginatedAggregation(pipeline, parsed)` helper would reduce that.

4. **Cursor-based pagination** — For real-time feeds (messages, activity), offset-based pagination has issues with insertions shifting pages. Our messages controller uses cursor-based (`before`/`after`) pagination, which is better for those cases.

---

## Conclusion

The full querying pipeline — query configs, `ctx.paginate()`, `buildMongo*` helpers, and the `findPaginated` repository pattern — gives us:

- **Consistency**: every list endpoint works the same way
- **Discoverability**: Swagger docs auto-generated from the same config
- **Safety**: only whitelisted fields can be filtered/sorted
- **Performance**: parallel data + count queries, MongoDB indexes
- **DX**: adding a new paginated endpoint takes 5 minutes

If you're building an API with more than a handful of list endpoints, standardize early. Your frontend team will thank you.

---

*This article is part of a series on building Vibed, a Jira-like task management backend with KickJS. Check out the [complete project guide](17-complete-project-guide.md) for the full walkthrough.*
