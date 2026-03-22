# Vibed -- AI Agent & Developer Guide

> Jira-like task management backend built with **KickJS v1.2.2** -- a decorator-driven Node.js framework on Express 5 + TypeScript.

---

## 1. Project Overview

| Aspect         | Detail                                                      |
|----------------|-------------------------------------------------------------|
| Runtime        | Node.js + TypeScript (ESM)                                  |
| Framework      | KickJS v1.2.2 (`@forinda/kickjs-*` packages)                |
| Database       | MongoDB via Mongoose 9                                      |
| Cache / Queue  | Redis (ioredis) + BullMQ                                    |
| Auth           | JWT (access + refresh rotation), bcryptjs                   |
| Email          | Resend (prod) / ConsoleProvider (dev) via MailerAdapter      |
| Realtime       | WebSocket chat (Socket.IO via WsAdapter), SSE live stats    |
| Jobs           | BullMQ queues (`email`, `notifications`, `activity`)        |
| Cron           | CronAdapter with overdue reminders, daily digest, token cleanup, presence cleanup |
| API docs       | Swagger via SwaggerAdapter                                  |
| Dev tools      | DevToolsAdapter at `/_debug/*`                              |
| Build          | Vite + SWC                                                  |
| Test           | Vitest                                                      |
| Package mgr    | pnpm                                                        |

---

## 2. Project Structure

```
src/
├── index.ts                        # Entry point -- delegates to config/
├── config/
│   ├── env.ts                      # Zod env validation + typed env object
│   ├── adapters.ts                 # All adapter configurations
│   └── middleware.ts               # Global Express middleware (cors, helmet, json, request-id)
├── shared/
│   ├── constants/
│   │   ├── tokens.ts               # DI Symbol tokens (TOKENS.USER_REPOSITORY, etc.)
│   │   ├── error-codes.ts          # Error code enum
│   │   └── query-configs.ts        # ApiQueryParamsConfig constants for ctx.paginate
│   ├── domain/
│   │   ├── base.entity.ts          # Base entity interface
│   │   └── repository.interface.ts # Base repository interface
│   ├── application/
│   │   ├── pagination.dto.ts       # Pagination DTO
│   │   └── api-response.dto.ts     # API response helpers
│   ├── infrastructure/
│   │   ├── database/
│   │   │   ├── mongoose.adapter.ts # MongooseAdapter (connects on beforeStart)
│   │   │   └── query-helpers.ts    # buildMongoFilter, buildMongoSort, buildMongoSearch
│   │   ├── redis/
│   │   │   └── redis.config.ts     # RedisAdapter
│   │   ├── mail/
│   │   │   └── resend.provider.ts  # ResendMailProvider
│   │   └── queue/
│   │       └── processor-registrar.adapter.ts  # ProcessorRegistrarAdapter
│   ├── guards/
│   │   ├── workspace-membership.guard.ts
│   │   ├── project-access.guard.ts
│   │   └── channel-membership.guard.ts
│   ├── presentation/middlewares/
│   │   ├── auth-bridge.middleware.ts   # JWT validation middleware (route-level)
│   │   └── request-id.middleware.ts    # X-Request-Id header
│   └── utils/
│       └── auth.ts                 # getUser(ctx) helper -- reads from ctx.get<AuthUser>('user')
└── modules/
    ├── index.ts                    # Module registry (all modules exported as array)
    ├── auth/                       # Register, login, JWT refresh/rotation, logout
    ├── users/                      # Profile CRUD
    ├── workspaces/                 # Organization CRUD + membership + invite
    ├── projects/                   # CRUD + board view
    ├── tasks/                      # CRUD + status/priority/assignees/reorder/subtasks
    ├── comments/                   # CRUD + @mention parsing
    ├── labels/                     # Workspace-scoped label CRUD
    ├── channels/                   # Chat channel CRUD + membership
    ├── messages/                   # REST history + WebSocket chat controller
    ├── notifications/              # In-app notifications + unread count
    ├── activity/                   # Activity feed (workspace / project / task)
    ├── attachments/                # File upload (multipart -> base64 -> MongoDB)
    ├── stats/                      # SSE live dashboard stats (workspace + project + activity)
    ├── queue/                      # BullMQ job processors (email, notification, activity)
    └── cron/                       # Scheduled jobs (reminders, digest, cleanup, presence)
```

### Module Internal Structure (DDD Layers)

Every module follows this layout:

```
module/
├── <name>.module.ts                # AppModule: register() + routes()
├── presentation/
│   └── <name>.controller.ts        # @Controller, @Get, @Post, etc.
├── application/
│   ├── dtos/                       # Zod validation schemas
│   └── use-cases/                  # Single-purpose business logic classes
├── domain/
│   ├── entities/                   # TypeScript interfaces
│   └── repositories/              # Repository interfaces
└── infrastructure/
    ├── schemas/                    # Mongoose schemas + models
    └── repositories/              # Mongo repository implementations
```

---

## 3. Key Patterns & Conventions

### Dependency Injection

| Where                  | Technique                              | Example                                        |
|------------------------|----------------------------------------|-------------------------------------------------|
| Controller properties  | `@Autowired()`                         | `@Autowired() private repo!: MongoUserRepo;`    |
| Use case constructor   | `@Inject(TOKENS.X)`                   | `constructor(@Inject(TOKENS.USER_REPOSITORY) private repo: UserRepository)` |
| Processor constructor  | `@Inject(MAILER)` / `@Inject(QUEUE)`  | Framework service symbols                       |
| Module `register()`    | `container.registerFactory(TOKEN, fn)` | Maps interface token to concrete implementation |

**Rule**: `@Inject(TOKEN)` = constructor params only. `@Autowired()` = property injection (resolves by class type).

`@Autowired()` will NOT work for services registered under Symbol tokens. Use `@Inject(SYMBOL)` in the constructor for those.

### Authentication

- **AuthAdapter is commented out** in `config/adapters.ts` -- using `authBridgeMiddleware` instead.
- Every protected controller class must have `@Middleware(authBridgeMiddleware)`.
- The auth module (`/auth`) does NOT use `authBridgeMiddleware` (public routes).
- `getUser(ctx)` reads from `ctx.get<AuthUser>('user')` — fixed in KickJS v1.2.5 (Issue #13 resolved).
- JWT access tokens expire in 15m; refresh tokens in 7d (configurable via env).

### Pagination

1. Define a query config as `ApiQueryParamsConfig` in `shared/constants/query-configs.ts`.
2. Add `@ApiQueryParams(CONFIG)` to the controller method for Swagger docs.
3. In the handler, call `ctx.paginate(fetcher, CONFIG)` -- it calls `ctx.qs()` internally.
4. The repository `findPaginated(parsed)` method uses `buildMongoFilter`, `buildMongoSort`, `buildMongoSearch` helpers.
5. Response shape: `{ data: [], meta: { page, limit, total, totalPages, hasNext, hasPrev } }`.

### Mongoose HMR Safety

**All schema files must use the guard pattern:**

```typescript
export const UserModel =
  (mongoose.models.User as mongoose.Model<UserDocument>) ||
  mongoose.model<UserDocument>('User', userSchema);
```

Without this, Vite HMR will crash with `OverwriteModelError`.

### Response Format

```typescript
// Success
successResponse(data, message?)
// -> { success: true, data, message }

// Paginated (automatic via ctx.paginate)
// -> { data: [], meta: { page, limit, total, totalPages, hasNext, hasPrev } }

// Error (framework)
// -> { statusCode, error, message }
```

### Middleware Types

There are two different middleware signatures. Mixing them up causes runtime crashes.

| Location                        | Signature                                | Receives         |
|---------------------------------|------------------------------------------|------------------|
| `bootstrap({ middleware })`     | Express `RequestHandler`                 | `(req, res, next)` |
| `@Middleware()` on class/method | KickJS `MiddlewareHandler`               | `(ctx, next)`    |
| Adapter `middleware()` phase    | Express `RequestHandler`                 | `(req, res, next)` |

### Naming Conventions

- Files: `kebab-case` (e.g., `create-task.use-case.ts`)
- Classes: `PascalCase` (e.g., `CreateTaskUseCase`)
- DI tokens: `SCREAMING_SNAKE` in `TOKENS` object (e.g., `TOKENS.TASK_REPOSITORY`)
- Module paths: Set in `routes()` return value, NOT in `@Controller()` (avoid route doubling)

---

## 4. Commands

```bash
kick dev              # Dev server with Vite HMR (hot reload)
kick dev:debug        # Dev server with debug output
kick build            # Production build
kick start            # Run production build
kick g module <name>  # Generate a DDD module scaffold
kick g controller <n> # Generate controller
kick g service <name> # Generate service
kick g dto <name>     # Generate Zod DTO

pnpm test             # Run tests (vitest run)
pnpm test:watch       # Watch mode tests
pnpm typecheck        # TypeScript type check (tsc --noEmit)
pnpm lint             # ESLint
pnpm format           # Prettier
```

---

## 5. Environment Variables

All defined in `.env.example` and validated by Zod in `src/config/env.ts`:

| Variable                | Type     | Default         | Description                              |
|-------------------------|----------|-----------------|------------------------------------------|
| `NODE_ENV`              | string   | `development`   | Runtime environment                      |
| `PORT`                  | number   | `3000`          | Server port (from KickJS base schema)    |
| `LOG_LEVEL`             | string   | —               | Pino log level (from KickJS base schema) |
| `MONGODB_URI`           | url      | —               | MongoDB connection string                |
| `REDIS_URL`             | url      | —               | Redis connection string                  |
| `JWT_SECRET`            | string   | —               | Access token signing secret (min 32 chars) |
| `JWT_REFRESH_SECRET`    | string   | —               | Refresh token signing secret (min 32 chars) |
| `JWT_ACCESS_EXPIRES_IN` | string   | `15m`           | Access token TTL                         |
| `JWT_REFRESH_EXPIRES_IN`| string   | `7d`            | Refresh token TTL                        |
| `RESEND_API_KEY`        | string   | —               | Resend API key (ConsoleProvider used in dev) |
| `MAIL_FROM_NAME`        | string   | `Vibed`         | Sender display name                      |
| `MAIL_FROM_EMAIL`       | email    | —               | Sender email address                     |
| `APP_URL`               | url      | —               | Public-facing app URL                    |
| `APP_NAME`              | string   | `Vibed`         | Application name                         |

---

## 6. API Endpoints

Base prefix: `/api/v1`

### Auth (`/api/v1/auth`) -- NO auth required

| Method | Path              | Description              |
|--------|-------------------|--------------------------|
| POST   | `/register`       | Register new user        |
| POST   | `/login`          | Login with credentials   |
| POST   | `/refresh`        | Refresh JWT token pair   |
| POST   | `/logout`         | Logout (invalidate refresh token) |

### Users (`/api/v1/users`)

| Method | Path        | Description              |
|--------|-------------|--------------------------|
| GET    | `/me`       | Get current user profile |
| PATCH  | `/me`       | Update current user profile |
| GET    | `/:id`      | Get user by ID           |
| GET    | `/`         | List users (paginated)   |

### Workspaces (`/api/v1/workspaces`)

| Method | Path                              | Description                    |
|--------|-----------------------------------|--------------------------------|
| POST   | `/`                               | Create workspace               |
| GET    | `/`                               | List user's workspaces         |
| GET    | `/:workspaceId`                   | Get workspace by ID            |
| PATCH  | `/:workspaceId`                   | Update workspace               |
| DELETE | `/:workspaceId`                   | Delete workspace               |
| POST   | `/:workspaceId/invite`            | Invite member to workspace     |
| GET    | `/:workspaceId/members`           | List workspace members         |
| PATCH  | `/:workspaceId/members/:userId`   | Update member role             |
| DELETE | `/:workspaceId/members/:userId`   | Remove member from workspace   |
| POST   | `/:workspaceId/leave`             | Leave workspace                |

### Projects (`/api/v1`)

| Method | Path                                       | Description            |
|--------|--------------------------------------------|------------------------|
| POST   | `/workspaces/:workspaceId/projects`        | Create project         |
| GET    | `/workspaces/:workspaceId/projects`        | List workspace projects |
| GET    | `/projects/:projectId`                     | Get project by ID      |
| PATCH  | `/projects/:projectId`                     | Update project         |
| DELETE | `/projects/:projectId`                     | Delete project         |
| GET    | `/projects/:projectId/board`               | Get board view (columns + tasks) |

### Tasks (`/api/v1`)

| Method | Path                              | Description                |
|--------|-----------------------------------|----------------------------|
| POST   | `/projects/:projectId/tasks`      | Create task                |
| GET    | `/projects/:projectId/tasks`      | List project tasks (paginated) |
| GET    | `/tasks/:taskId`                  | Get task by ID             |
| PATCH  | `/tasks/:taskId`                  | Update task                |
| DELETE | `/tasks/:taskId`                  | Delete task                |
| PATCH  | `/tasks/:taskId/status`           | Change task status         |
| PATCH  | `/tasks/:taskId/assignees`        | Update task assignees      |
| POST   | `/tasks/:taskId/reorder`          | Reorder task in column     |
| GET    | `/tasks/:taskId/subtasks`         | List subtasks              |

### Comments (`/api/v1`)

| Method | Path                              | Description            |
|--------|-----------------------------------|------------------------|
| POST   | `/tasks/:taskId/comments`         | Create comment         |
| GET    | `/tasks/:taskId/comments`         | List task comments     |
| PATCH  | `/comments/:commentId`            | Update comment         |
| DELETE | `/comments/:commentId`            | Delete comment         |

### Labels (`/api/v1`)

| Method | Path                                   | Description          |
|--------|----------------------------------------|----------------------|
| POST   | `/workspaces/:workspaceId/labels`      | Create label         |
| GET    | `/workspaces/:workspaceId/labels`      | List workspace labels |
| PATCH  | `/labels/:labelId`                     | Update label         |
| DELETE | `/labels/:labelId`                     | Delete label         |

### Attachments (`/api/v1`)

| Method | Path                                       | Description              |
|--------|---------------------------------------------|--------------------------|
| POST   | `/tasks/:taskId/attachments`                | Upload attachment        |
| GET    | `/tasks/:taskId/attachments`                | List task attachments    |
| GET    | `/attachments/:attachmentId`                | Get attachment metadata  |
| GET    | `/attachments/:attachmentId/download`       | Download attachment file |
| DELETE | `/attachments/:attachmentId`                | Delete attachment        |

### Channels (`/api/v1`)

| Method | Path                                          | Description            |
|--------|-----------------------------------------------|------------------------|
| POST   | `/workspaces/:workspaceId/channels`           | Create channel         |
| GET    | `/workspaces/:workspaceId/channels`           | List workspace channels |
| GET    | `/channels/:channelId`                        | Get channel by ID      |
| DELETE | `/channels/:channelId`                        | Delete channel         |
| POST   | `/channels/:channelId/members`                | Add member to channel  |
| DELETE | `/channels/:channelId/members/:userId`        | Remove channel member  |

### Messages (`/api/v1`)

| Method | Path                                      | Description          |
|--------|-------------------------------------------|----------------------|
| GET    | `/channels/:channelId/messages`           | List message history (paginated) |
| PATCH  | `/messages/:messageId`                    | Edit message         |
| DELETE | `/messages/:messageId`                    | Delete message       |

### Notifications (`/api/v1/notifications`)

| Method | Path            | Description                      |
|--------|-----------------|----------------------------------|
| GET    | `/`             | List notifications (paginated)   |
| PATCH  | `/:id/read`     | Mark notification as read        |
| POST   | `/read-all`     | Mark all notifications as read   |
| GET    | `/unread-count` | Get unread notification count    |

### Activity (`/api/v1`)

| Method | Path                                          | Description                    |
|--------|-----------------------------------------------|--------------------------------|
| GET    | `/workspaces/:workspaceId/activity`           | List workspace activity (paginated) |
| GET    | `/projects/:projectId/activity`               | List project activity (paginated) |
| GET    | `/tasks/:taskId/activity`                     | List task activity             |

### Stats -- SSE (`/api/v1`)

| Method | Path                                              | Description                      |
|--------|---------------------------------------------------|----------------------------------|
| GET    | `/workspaces/:workspaceId/stats/live`             | SSE stream: workspace stats      |
| GET    | `/projects/:projectId/stats/live`                 | SSE stream: project stats        |
| GET    | `/workspaces/:workspaceId/activity/live`          | SSE stream: workspace activity   |

### WebSocket (`/ws/chat`)

| Event               | Direction | Description                    |
|---------------------|-----------|--------------------------------|
| `channel:join`      | Client->  | Join a channel room            |
| `channel:leave`     | Client->  | Leave a channel room           |
| `message:send`      | Client->  | Send a message to channel      |
| `message:edit`      | Client->  | Edit an existing message       |
| `message:delete`    | Client->  | Delete a message               |
| `channel:typing`    | Client->  | Broadcast typing indicator     |
| `channel:stop_typing` | Client-> | Stop typing indicator          |

---

## 7. Resources

| Resource            | Location                                          |
|---------------------|---------------------------------------------------|
| KickJS Docs         | https://forinda.github.io/kick-js/                |
| KickJS Source       | `/home/forinda/dev/personal/kick-js`              |
| KickJS Examples     | `/home/forinda/dev/personal/kick-js/examples/`    |
| Framework Issues    | `./framework-issues.md`                           |
| Articles            | `./articles/`                                     |
| Swagger UI          | `http://localhost:3000/api-docs` (dev only)       |
| DevTools            | `http://localhost:3000/_debug/` (dev only)        |

---

## 8. Known Issues & Workarounds

These are tracked in detail in `framework-issues.md`. Summary of each:

| #  | Issue                                      | Workaround                                                        |
|----|--------------------------------------------|--------------------------------------------------------------------|
| 1  | `kick new` not scriptable                  | Pipe `echo "1"` into the command                                  |
| 2  | Nodemailer peer dep mismatch               | Ignore warning; works fine with v8                                |
| 3  | QueueModule/CronModule need routes()       | Return stub object (but see #11)                                  |
| 4  | `loadEnv()` loosely typed                  | Cast result with explicit type annotation                         |
| 5  | Zod v4 import path                         | Use `import { z } from 'zod'` (not subpaths)                     |
| 6  | QueueAdapter expects strings, not classes  | Pass queue name strings; import processors as side-effects        |
| 7  | Mongoose `OverwriteModelError` on HMR      | Use `mongoose.models.X \|\| mongoose.model()` guard              |
| 8  | `@Job`/`@Service` lose DI on HMR          | Ignore error in dev; restart for clean state                      |
| 9  | `QueryParamsConfig` vs `ApiQueryParamsConfig` | Use `ApiQueryParamsConfig` from `@forinda/kickjs-core`          |
| 9b | Route path doubling                        | Use `@Controller()` with no path when module sets the path        |
| 10 | Global middleware gets Express handlers    | Use `(req, res, next)` signature, not `(ctx, next)`              |
| 11 | Modules without routes crash Express       | Don't register in modules array; import as side-effects instead   |
| 12 | DevToolsAdapter loses peer refs on HMR     | Restart `kick dev` fully for DevTools                             |
| 13 | `ctx.set()`/`ctx.get()` broken across middleware -> handler | Store data on `(ctx.req as any).prop`; use `getUser(ctx)` helper |

---

## 9. HMR Guide

KickJS uses Vite HMR via `kick dev`. This section tells you what survives a hot reload vs what needs a cold restart.

### Safe to edit (survives HMR)

- Controller logic (routes re-mount on rebuild)
- Use case / service logic (DI resolves fresh instances)
- DTO / Zod validation schemas (re-evaluated on import)
- Guard / middleware logic (re-registered with routes)
- Mongoose schemas (with `mongoose.models.X ||` guard)
- Email templates / HTML strings

### Needs full restart (`Ctrl+C` then `kick dev`)

- Adapter options in `config/adapters.ts`
- Auth policy changes
- Adding new modules to the `modules` array
- Adding new adapters to the `adapters` array
- Queue processor class changes (new class identity breaks old DI binding)
- DevTools peer adapter references

### Recognizing HMR-only errors

- `No binding found for: EmailProcessor` -- cosmetic; workers from cold boot still run. Safe to ignore.
- `/_debug/queues` returning "not found" -- DevTools lost adapter refs. Restart to fix.
- `OverwriteModelError` -- missing the Mongoose HMR guard. Fix the schema file.

---

## 10. Adding a New Module

Step-by-step guide for creating a new module from scratch.

### Step 1: Generate the scaffold

```bash
kick g module <name>
```

This creates the basic directory structure. You will need to fill in the layers below.

### Step 2: Create the entity interface

```typescript
// src/modules/<name>/domain/entities/<name>.entity.ts
export interface MyEntity {
  _id: string;
  name: string;
  workspaceId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Step 3: Create the repository interface

```typescript
// src/modules/<name>/domain/repositories/<name>.repository.ts
export interface MyEntityRepository {
  create(data: Partial<MyEntity>): Promise<MyEntity>;
  findById(id: string): Promise<MyEntity | null>;
  findPaginated(parsed: any): Promise<{ data: MyEntity[]; total: number }>;
  update(id: string, data: Partial<MyEntity>): Promise<MyEntity | null>;
  delete(id: string): Promise<boolean>;
}
```

### Step 4: Create the Mongoose schema (with HMR guard)

```typescript
// src/modules/<name>/infrastructure/schemas/<name>.schema.ts
import mongoose, { Schema, Document } from 'mongoose';
import type { MyEntity } from '../../domain/entities/<name>.entity';

export interface MyEntityDocument extends MyEntity, Document {}

const myEntitySchema = new Schema<MyEntityDocument>(
  {
    name: { type: String, required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  },
  { timestamps: true },
);

// HMR guard -- REQUIRED
export const MyEntityModel =
  (mongoose.models.MyEntity as mongoose.Model<MyEntityDocument>) ||
  mongoose.model<MyEntityDocument>('MyEntity', myEntitySchema);
```

### Step 5: Create the Mongo repository

```typescript
// src/modules/<name>/infrastructure/repositories/mongo-<name>.repository.ts
import { Service } from '@forinda/kickjs-core';
import { MyEntityModel } from '../schemas/<name>.schema';
import type { MyEntityRepository } from '../../domain/repositories/<name>.repository';
import { buildMongoFilter, buildMongoSort, buildMongoSearch } from '@/shared/infrastructure/database/query-helpers';

@Service()
export class MongoMyEntityRepository implements MyEntityRepository {
  async create(data: Partial<MyEntity>) {
    return MyEntityModel.create(data);
  }
  async findById(id: string) {
    return MyEntityModel.findById(id).lean();
  }
  async findPaginated(parsed: any) {
    const filter = { ...buildMongoFilter(parsed), ...buildMongoSearch(parsed) };
    const sort = buildMongoSort(parsed);
    const [data, total] = await Promise.all([
      MyEntityModel.find(filter).sort(sort).skip(parsed.skip).limit(parsed.limit).lean(),
      MyEntityModel.countDocuments(filter),
    ]);
    return { data, total };
  }
  async update(id: string, data: Partial<MyEntity>) {
    return MyEntityModel.findByIdAndUpdate(id, data, { new: true }).lean();
  }
  async delete(id: string) {
    const result = await MyEntityModel.findByIdAndDelete(id);
    return !!result;
  }
}
```

### Step 6: Create DTOs with Zod

```typescript
// src/modules/<name>/application/dtos/create-<name>.dto.ts
import { z } from 'zod';

export const createMyEntitySchema = z.object({
  name: z.string().min(1).max(100),
});

export type CreateMyEntityDto = z.infer<typeof createMyEntitySchema>;
```

### Step 7: Create use cases

```typescript
// src/modules/<name>/application/use-cases/create-<name>.use-case.ts
import { Service, Inject } from '@forinda/kickjs-core';
import { TOKENS } from '@/shared/constants/tokens';
import type { MyEntityRepository } from '../../domain/repositories/<name>.repository';

@Service()
export class CreateMyEntityUseCase {
  constructor(
    @Inject(TOKENS.MY_ENTITY_REPOSITORY) private repo: MyEntityRepository,
  ) {}

  async execute(data: CreateMyEntityDto, userId: string) {
    return this.repo.create({ ...data, createdBy: userId });
  }
}
```

### Step 8: Create the controller

```typescript
// src/modules/<name>/presentation/<name>.controller.ts
import { Controller, Middleware, Autowired } from '@forinda/kickjs-core';
import { Get, Post, Patch, Delete } from '@forinda/kickjs-http';
import { ApiTags, ApiOperation, ApiResponse } from '@forinda/kickjs-swagger';
import type { RequestContext } from '@forinda/kickjs-http';
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware';
import { successResponse } from '@/shared/application/api-response.dto';
import { getUser } from '@/shared/utils/auth';
import { CreateMyEntityUseCase } from '../application/use-cases/create-<name>.use-case';
import { createMyEntitySchema } from '../application/dtos/create-<name>.dto';

@Controller()
@ApiTags('MyEntity')
@Middleware(authBridgeMiddleware)
export class MyEntityController {
  @Autowired() private createUseCase!: CreateMyEntityUseCase;

  @Post('/my-entities', { body: createMyEntitySchema })
  @ApiOperation({ summary: 'Create a new entity' })
  @ApiResponse({ status: 201, description: 'Entity created' })
  async create(ctx: RequestContext) {
    const user = getUser(ctx);
    const result = await this.createUseCase.execute(ctx.body, user.id);
    ctx.status(201).json(successResponse(result, 'Entity created'));
  }
}
```

### Step 9: Register in the module

```typescript
// src/modules/<name>/<name>.module.ts
import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
import { buildRoutes } from '@forinda/kickjs-http';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoMyEntityRepository } from './infrastructure/repositories/mongo-<name>.repository';
import { MyEntityController } from './presentation/<name>.controller';

export class MyEntityModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.MY_ENTITY_REPOSITORY, () =>
      container.resolve(MongoMyEntityRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/',            // Or '/my-entities' -- but NOT both here and @Controller
      router: buildRoutes(MyEntityController),
      controller: MyEntityController,
    };
  }
}
```

### Step 10: Add to `modules/index.ts`

```typescript
import { MyEntityModule } from './<name>/<name>.module';

export const modules: AppModuleClass[] = [
  // ... existing modules
  MyEntityModule,
];
```

Then **restart `kick dev`** (adding a new module to the array does not survive HMR).

### Step 11: Add the DI token

In `src/shared/constants/tokens.ts`, add:

```typescript
MY_ENTITY_REPOSITORY: Symbol('MyEntityRepository'),
```

---

## Quick Reference Checklist

When modifying existing code, verify:

- [ ] Mongoose schemas use the HMR guard (`mongoose.models.X || ...`)
- [ ] Controllers use `@Controller()` with NO path argument (module sets the path)
- [ ] Protected controllers have `@Middleware(authBridgeMiddleware)`
- [ ] Auth data accessed via `getUser(ctx)`, NOT `ctx.get('user')`
- [ ] Pagination uses `ctx.paginate(fetcher, CONFIG)`, NOT manual `ctx.qs()`
- [ ] Queue processors registered as side-effect imports, not in modules array
- [ ] Use `@Inject(TOKEN)` for constructor params, `@Autowired()` for properties
- [ ] New modules require a full restart of `kick dev`
