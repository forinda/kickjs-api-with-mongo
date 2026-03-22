# KICK-018: Type-safe API client generation (tRPC-like)

- **Status**: Open
- **Severity**: —
- **Found in**: —
- **Fixed in**: —
- **Component**: cli, http, swagger
- **Type**: Feature Request

## Problem
KickJS backends already define fully typed routes with Zod DTOs (`@Validate`, `@ApiBody`, `@ApiResponse`) and route decorators (`@Get`, `@Post`, etc.), but frontend consumers have no way to leverage these types. Developers must manually duplicate types or write untyped fetch calls, which defeats the purpose of the strong backend typing.

## Proposed Feature
A **tRPC-like typed client** that gives frontend consumers end-to-end type safety from KickJS route definitions — without a separate code generation step or runtime overhead.

### How it could work

#### Option A: Build-time client extraction (Recommended)
A CLI command that scans route decorators and Zod DTOs to generate a typed client package:

```bash
kick generate:client --out ./client
```

Produces:
```ts
// Generated client
import { createClient } from '@forinda/kickjs-client';

const api = createClient<AppRoutes>({ baseUrl: 'http://localhost:3000/api/v1' });

// Fully typed — params, body, and response inferred from backend
const task = await api.tasks.create({
  body: { title: 'Fix bug', priority: 'high' },
});

const tasks = await api.tasks.list({
  query: { status: 'open', sort: '-createdAt', limit: 20 },
});

const user = await api.users.me();
```

The generator would read:
- `@Get('/')`, `@Post('/')`, etc. → HTTP method + path
- `@Validate(CreateTaskDto)` / `@ApiBody(schema)` → request body type
- `@ApiResponse(schema)` → response type
- `@ApiQueryParams(config)` → query parameter types
- Module `routes()` path → URL prefix

#### Option B: Runtime inference via OpenAPI
Since KickJS already generates an OpenAPI spec via `SwaggerAdapter`, generate a typed client from the spec at build time:

```bash
kick generate:client --from openapi --out ./client
```

This leverages the existing `/openapi.json` endpoint. Less magical than Option A but works with any OpenAPI-compatible tooling.

#### Option C: Shared type package (minimal)
Export Zod schemas as a shared package that both backend and frontend import:

```ts
// @vibed/api-types (shared package)
export { CreateTaskDto, TaskResponseDto } from './dtos';
export type { Task, User, Workspace } from './entities';
```

Frontend uses them with a generic typed fetch wrapper:

```ts
import { CreateTaskDto, TaskResponseDto } from '@vibed/api-types';

const task = await api.post<TaskResponseDto>('/tasks', CreateTaskDto.parse(body));
```

Simpler but doesn't provide route-level type safety.

## What KickJS already has
- Zod DTOs with full request validation (`@Validate`)
- Route decorators with path + method (`@Get`, `@Post`, etc.)
- Swagger/OpenAPI generation with `@ApiBody`, `@ApiResponse`, `@ApiQueryParams`
- Module-level route mounting with versioned prefixes

All the metadata needed for a typed client already exists — it just needs to be surfaced.

## Example: What the DX should look like

```ts
// Frontend code — fully typed, zero manual type definitions
import { createApiClient } from '@vibed/api-client';

const api = createApiClient({ baseUrl: '/api/v1', token: accessToken });

// ✅ Body typed as CreateTaskDto, response typed as TaskResponse
const { data: task } = await api.tasks.create({
  title: 'Implement feature',
  projectId: 'proj_123',
  priority: 'high',
});

// ✅ Query params typed from ApiQueryParamsConfig
const { data: tasks, pagination } = await api.tasks.list({
  query: { status: 'open', assigneeId: 'user_456' },
});

// ✅ Path params typed from route definition
const { data: workspace } = await api.workspaces.getById({
  params: { workspaceId: 'ws_789' },
});

// ✅ Auth handled automatically
const { data: me } = await api.users.me();
```

## Prior Art
- **tRPC** — end-to-end type safety via shared router type, no codegen
- **Nuxt `$fetch`** — auto-typed from `server/api/` file structure
- **Hono RPC** — `hc<AppType>()` client inferred from Hono routes
- **ts-rest** — contract-first shared types between client and server
- **OpenAPI Generator** — codegen from OpenAPI spec (language-agnostic)

## Synergy with SpaAdapter

KickJS already supports serving SPAs via `SpaAdapter`. Combined with a typed client, this enables a **full-stack monorepo** workflow:

```
project/
├── src/                  # KickJS backend
│   └── modules/
├── client/               # Generated typed API client
│   └── index.ts
└── frontend/             # SPA (React, Vue, etc.)
    └── src/
        └── api.ts        # import { createApiClient } from '../client'
```

- `SpaAdapter` serves the built frontend from the same server
- The generated client imports types directly — no API boundary to cross
- `kick dev` could watch both backend and frontend with HMR
- Single deploy: backend + SPA + typed client all in one

This would position KickJS as a **full-stack framework** comparable to Nuxt/Next but with a decorator-driven DDD backend, rather than just a backend framework that happens to serve static files.

### Possible workflow
```bash
kick new my-app --spa react        # Scaffold full-stack project
kick generate:client               # Generate typed client from routes
kick dev                           # HMR for backend + SPA
kick build                         # Build backend + SPA for production
```

## Benefits
- End-to-end type safety from Zod DTOs to frontend fetch calls
- Catch API contract violations at compile time, not runtime
- Auto-complete for routes, params, body, and response types
- Eliminates manual type duplication between backend and frontend
- Leverages metadata KickJS already collects
- Natural pairing with SpaAdapter for full-stack monorepo DX

## References
- Related: SwaggerAdapter already collects most of this metadata
- Related: SpaAdapter already serves SPAs from the same server
- tRPC: https://trpc.io
- Hono RPC: https://hono.dev/docs/guides/rpc
- Nuxt: https://nuxt.com (full-stack Vue framework with typed API routes)
