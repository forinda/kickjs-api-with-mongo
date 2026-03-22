# KickJS Framework Issues & Notes

Tracking issues, workarounds, and observations encountered while building with KickJS v1.2.2.

## Issues

### 1. `kick new` interactive prompt not scriptable
- **Description**: `kick new` always prompts for template selection interactively, even when using `--template` flag or piping input
- **Workaround**: Pipe `echo "1"` into the command: `echo "1" | kick new <name> --pm pnpm --no-git --install`
- **Suggestion**: Support `--template rest` flag to skip interactive prompt

### 2. Nodemailer peer dependency mismatch
- **Description**: `@forinda/kickjs-mailer@1.2.2` requires `nodemailer@^6.0.0` as peer dependency but `kick add mailer` installs `nodemailer@8.0.3`
- **Impact**: Warning during install: `✕ unmet peer nodemailer@^6.0.0: found 8.0.3`
- **Suggestion**: Update peer dependency range to `>=6.0.0` or `^6.0.0 || ^7.0.0 || ^8.0.0`

### 3. QueueModule and CronModule route registration
- **Description**: `AppModule.routes()` is required to return a `ModuleRoutes` object, but queue processors and cron jobs don't have HTTP routes. Returning `undefined` or empty object causes type errors.
- **Workaround**: Return a stub: `{ path: '/', router: undefined as any, controller: undefined as any }`
- **Suggestion**: Make `routes()` return type `ModuleRoutes | ModuleRoutes[] | null` to support non-HTTP modules

### 4. `loadEnv()` returns loosely typed object
- **Description**: `defineEnv()` signature is `defineEnv<T>(extend: (base) => z.ZodObject<any>)` — the `any` in the return type erases the extended schema shape. `loadEnv(envSchema)` then returns `z.infer<z.ZodObject<any>>` which resolves to `{ [x: string]: any }`, making all env properties typed as `unknown` in strict mode.
- **Impact**: Every usage of `env.JWT_SECRET`, `env.MONGODB_URI`, etc. requires explicit type assertion or a manual type annotation.
- **Workaround**: Cast the result: `export const env = loadEnv(envSchema) as { PORT: number; JWT_SECRET: string; ... }`
- **Suggestion**: Fix `defineEnv` generic to preserve the extended schema type: `defineEnv<T extends z.ZodRawShape>(extend: (base) => z.ZodObject<T>): z.ZodObject<T & BaseShape>`

### 5. Zod v4 import path
- **Description**: `kick new` installs `zod@4.x` which uses `zod` as the import path. The docs show `zod` imports which work fine, but some older examples may reference `zod/v4` or `@zod` subpaths.
- **Note**: Not a breaking issue, just worth noting for doc consistency.

### 6. QueueAdapter `queues` option expects strings, not classes
- **Description**: The docs show passing processor classes to `queues: [EmailProcessor]`, but the actual `QueueAdapterOptions` type defines `queues?: string[]`. Passing classes causes `TypeError: name.includes is not a function` at runtime inside BullMQ's `QueueBase` constructor.
- **Workaround**: Pass queue name strings: `queues: ['email', 'notifications']`. Import processor files as side-effects (`import './processors/email.processor'`) so `@Job`/`@Process` decorators register them in DI.
- **Suggestion**: Either update the docs to show string names, or update the adapter to accept `Function[]` and extract queue names from `@Job` metadata.

### 7. Mongoose `OverwriteModelError` during HMR
- **Description**: `kick dev` uses Vite HMR which re-executes module files on change. Mongoose schema files that call `mongoose.model('Name', schema)` at the top level will throw `OverwriteModelError: Cannot overwrite 'Name' model once compiled` on the second execution.
- **Impact**: Dev server crashes on any file save that triggers a re-import chain through a schema file.
- **Workaround**: Use the guard pattern in all schema files:
  ```typescript
  export const UserModel = (mongoose.models.User as mongoose.Model<UserDocument>) || mongoose.model<UserDocument>('User', userSchema);
  ```
- **Suggestion**: The `kick g module` generator should emit this HMR-safe pattern by default instead of bare `mongoose.model()` calls. Alternatively, the `MongooseAdapter` could provide a helper like `defineModel('User', userSchema)` that handles the guard internally.

### 8. `@Job`/`@Service` processor classes lose DI binding on HMR reload
- **Description**: When Vite HMR re-evaluates a module containing `@Service()` / `@Job()` decorated classes, the JavaScript runtime creates NEW class objects with new identity. The DI container still holds bindings for the OLD class identity. When `QueueAdapter.beforeStart()` runs during rebuild, it calls `container.resolve(jobClass)` with the NEW class reference, which has no binding — causing `No binding found for: EmailProcessor`.
- **Impact**: Error logged on every HMR reload. Does NOT break the running app — workers from the initial cold boot continue processing jobs. The error is cosmetic in development.
- **Workaround**: Ignore the error during development. For a clean state, restart `kick dev` fully. In production (no HMR), this never occurs.
- **Suggestion**: The DI container's `register()` and `resolve()` could use class name strings as fallback keys (not just object identity) to survive HMR class re-creation. Alternatively, `QueueAdapter` could re-register processor classes during rebuild.

### 9. Query config type export name mismatch in docs
- **Description**: The docs reference `QueryParamsConfig` as the type for query field configurations, but the actual exported type from `@forinda/kickjs-core` is `ApiQueryParamsConfig`.
- **Impact**: Using `QueryParamsConfig` causes a compile error since it doesn't exist in the package exports.
- **Workaround**: Use `import type { ApiQueryParamsConfig } from '@forinda/kickjs-core'` instead.
- **Suggestion**: Either update the docs to reference `ApiQueryParamsConfig`, or add `QueryParamsConfig` as a re-export alias.

### 9. Route path doubling when `@Controller` path matches module `routes()` path
- **Description**: When a module's `routes()` returns `{ path: '/users', ... }` and the controller is decorated with `@Controller('/users')`, the final mounted route becomes `/api/v1/users/users/...` — the path is applied twice.
- **Impact**: All routes on that controller get a doubled prefix, returning 404s on the expected paths.
- **Workaround**: Use `@Controller()` (no path argument) when the module already defines the mount path in `routes()`. Only use one or the other to set the prefix, not both.
- **Suggestion**: The framework should either deduplicate matching prefixes, or `kick g module` should generate `@Controller()` without a path by default since the module path takes precedence.

### 10. Global middleware in `bootstrap()` receives Express handlers, not `RequestContext`
- **Description**: The `middleware` array in `bootstrap({ middleware: [...] })` accepts raw Express middleware `(req, res, next)`, not KickJS `MiddlewareHandler` which receives `(ctx: RequestContext, next)`. Only class/method-level `@Middleware` decorators use `RequestContext`.
- **Impact**: Writing global middleware with `(ctx: RequestContext, next)` signature crashes at runtime (`Cannot set properties of undefined`).
- **Workaround**: Use standard Express signature `(req: Request, res: Response, next: NextFunction)` for global middleware.
- **Suggestion**: Document this distinction clearly, or normalize both to accept either signature.

### 11. Modules without routes crash Express with `argument handler must be a function`
- **Description**: `AppModule.routes()` is required to return a `ModuleRoutes` object. Modules that don't have HTTP routes (e.g., queue processors, cron jobs) must still return something. Returning `{ path: '/', router: undefined as any, controller: undefined as any }` causes Express to crash with `TypeError: argument handler must be a function` because it tries to mount `undefined` as a route handler.
- **Impact**: Cannot register queue/cron modules in the modules array without crashing.
- **Workaround**: Don't register route-less modules in the `modules` array. Instead, import processors/services as side-effects in `config/adapters.ts` so their `@Service()`/`@Job()` decorators run and register in DI before the adapters start.
- **Suggestion**: Support `routes()` returning `null` or `undefined` to indicate a module with no HTTP routes. Alternatively, provide a `ServiceModule` base class that doesn't require `routes()`.

### 12. DevToolsAdapter `peerAdapters` lost on HMR rebuild
- **Description**: `DevToolsAdapter({ adapters: [wsAdapter, queueAdapter] })` stores peer adapter references at construction time. On HMR rebuild, `bootstrap()` calls `g.__app.rebuild()` which reuses the OLD app/adapter instances — the new adapter instances created in the re-evaluated `adapters.ts` module are never passed to the existing DevTools instance.
- **Impact**: `/_debug/queues` and `/_debug/ws` endpoints show "not found" after HMR, even though queues are running.
- **Workaround**: Restart `kick dev` fully (not HMR) to get fresh adapter references. Or accept that queue/ws devtools only work after a cold start.
- **Suggestion**: DevToolsAdapter should discover peer adapters from the app's adapter registry at request time rather than caching constructor references. E.g., `app.getAdapters().find(a => a.name === 'QueueAdapter')`.

### 13. ~~`ctx.set()`/`ctx.get()` metadata NOT shared between middleware and handler~~ ✅ FIXED in v1.2.5
- **Status**: Resolved in KickJS v1.2.5. The metadata Map is now stored on `req` and shared across all `RequestContext` instances for the same request. `ctx.set()` in middleware is visible to `ctx.get()` in the handler.
- **Migration**: Use `ctx.get<T>('key')` / `ctx.set('key', value)` directly — no need for `(ctx.req as any)` workarounds.

## Feature Requests

### 1. DevToolsAdapter SSE streaming for live metrics
- **Description**: DevTools currently serves JSON snapshots at `/_debug/metrics`, `/_debug/health`, `/_debug/queues`, etc. The dashboard Vue app has to poll these endpoints for updates. Since DevTools already uses reactive state (`ref`, `computed`, `watch` from `@forinda/kickjs-core`), it could expose a `GET /_debug/stream` SSE endpoint that pushes updates in real-time as reactive values change.
- **Proposed API**:
  ```
  GET /_debug/stream
  Content-Type: text/event-stream

  event: metrics
  data: {"requests":42,"errorRate":0.02,"uptimeSeconds":3600}

  event: route-latency
  data: {"route":"POST /register","count":5,"avgMs":120}

  event: queue-stats
  data: {"name":"email","waiting":2,"active":1,"completed":50,"failed":0}

  event: ws-stats
  data: {"activeConnections":12,"messagesReceived":340}

  event: health
  data: {"status":"healthy","errorRate":0.02}
  ```
- **Implementation idea**: Use `watch()` on the existing reactive refs (`requestCount`, `errorCount`, `errorRate`) to trigger SSE sends. For queue/ws stats, poll peer adapters on a configurable interval (e.g., every 5s) and push deltas.
- **Benefit**: The DevTools dashboard would get instant updates without polling, and external monitoring tools could subscribe to the stream for real-time observability.

### 2. Runtime-configurable WsAdapter heartbeat interval
- **Description**: The `WsAdapter` `heartbeatInterval` is set once at construction and can't be changed at runtime. For different environments (dev vs staging vs production) or use cases (chat needs fast detection, dashboards don't), it would be useful to change the heartbeat interval without restarting.
- **Proposed API**:
  ```typescript
  // Option A: Via DevTools endpoint
  // PATCH /_debug/ws/config  { "heartbeatInterval": 15000 }

  // Option B: Via reactive config
  const wsAdapter = new WsAdapter({
    heartbeatInterval: ref(30000), // reactive — changes take effect immediately
  });

  // Option C: Method on the adapter
  wsAdapter.setHeartbeatInterval(15000);
  ```
- **Use cases**: Tighten heartbeat during incidents to quickly detect dead connections; loosen during low-traffic periods to save resources; allow ops teams to tune via DevTools dashboard without redeployment.

### 4. `kick readme` CLI command to generate/update README.md
- **Description**: The CLI has no command for generating a README. Projects scaffolded with `kick new` don't include one. There should be a dedicated `kick readme` command that introspects the project and generates a comprehensive README.
- **Proposed CLI**:
  ```bash
  kick readme              # Generate README.md from project state
  kick readme --update     # Update existing README, preserving custom sections
  kick readme --format min # Minimal: title, setup, commands only
  ```
- **What it should introspect**:
  - Project name/version/description from `package.json`
  - Template type from `kick.config.ts`
  - Installed `@forinda/kickjs-*` packages → tech stack table
  - Modules from `src/modules/` → module list with descriptions
  - Routes from controller decorators → API endpoint summary
  - Env vars from `.env.example` → environment variables table
  - Scripts from `package.json` → available commands
  - Swagger endpoint → link to `/docs`
- **When it should run**:
  - `kick new` should call `kick readme` automatically after scaffolding
  - `kick g module` could prompt to update the README
  - Developers run `kick readme --update` manually as the project grows
- **Benefit**: Every KickJS project gets a README from the first commit that stays in sync with the actual codebase. No more stale docs.

## Middleware Types Reference

There are **two different middleware signatures** in KickJS depending on where you use them. Mixing them up causes runtime crashes.

### 1. Global middleware — raw Express handler
**Where**: `bootstrap({ middleware: [...] })`
**Signature**: `(req: Request, res: Response, next: NextFunction) => void`
**Import types from**: `express`

```typescript
import type { Request, Response, NextFunction } from 'express';

export const myGlobalMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // req.headers, res.setHeader(), etc.
  next();
};

bootstrap({ middleware: [myGlobalMiddleware] });
```

### 2. Route-level middleware — KickJS `MiddlewareHandler`
**Where**: `@Middleware(handler)` on class or method
**Signature**: `(ctx: RequestContext, next: () => void) => void | Promise<void>`
**Import types from**: `@forinda/kickjs-core` and `@forinda/kickjs-http`

```typescript
import type { MiddlewareHandler } from '@forinda/kickjs-core';
import type { RequestContext } from '@forinda/kickjs-http';

export const myRouteMiddleware: MiddlewareHandler = (ctx: RequestContext, next) => {
  // ctx.headers, ctx.params, ctx.json(), ctx.set(), ctx.get(), etc.
  next();
};

@Controller()
@Middleware(myRouteMiddleware)  // class-level
export class MyController {
  @Get('/')
  @Middleware(myRouteMiddleware)  // method-level
  async handler(ctx: RequestContext) { ... }
}
```

### Quick rule
| Location | Type | Receives |
|---|---|---|
| `bootstrap({ middleware })` | Express `RequestHandler` | `(req, res, next)` |
| `@Middleware()` on class | KickJS `MiddlewareHandler` | `(ctx, next)` |
| `@Middleware()` on method | KickJS `MiddlewareHandler` | `(ctx, next)` |
| Adapter `middleware()` phase | Express `RequestHandler` | `(req, res, next)` |

### 3. Shared `RequestContext` per request lifecycle
- **Description**: Currently `router-builder.ts` creates a `new RequestContext(req, res, next)` for EACH middleware and handler separately. This means `ctx.set()` in middleware is invisible to `ctx.get()` in the handler because each has its own private `metadata` Map. This forces developers to mutate `req` directly (e.g., `(ctx.req as any).user = user`), which defeats the purpose of having a typed context abstraction.
- **Proposed solution**: Attach the `RequestContext` to `req` on first creation, then reuse it for all subsequent middleware/handler calls in the same request:
  ```typescript
  // In router-builder.ts — replace per-middleware/handler context creation

  // Option A: Lazy singleton per request (recommended)
  function getOrCreateContext(req: Request, res: Response, next: NextFunction): RequestContext {
    if (!(req as any).__ctx) {
      (req as any).__ctx = new RequestContext(req, res, next);
    }
    return (req as any).__ctx;
  }

  // Then in middleware wrappers:
  handlers.push((req, res, next) => {
    const ctx = getOrCreateContext(req, res, next);
    Promise.resolve(mw(ctx, next)).catch(next);
  });

  // And in the handler:
  handlers.push(async (req, res, next) => {
    const ctx = getOrCreateContext(req, res, next);
    const controller = container.resolve(controllerClass);
    await controller[route.handlerName](ctx);
  });

  // Option B: Store metadata on req (minimal change)
  // In RequestContext constructor:
  private get metadata(): Map<string, any> {
    if (!(this.req as any).__ctxMeta) {
      (this.req as any).__ctxMeta = new Map();
    }
    return (this.req as any).__ctxMeta;
  }
  ```
- **Benefits**:
  - `ctx.set('user', user)` in middleware → `ctx.get('user')` in handler just works
  - No need to mutate `req` directly for per-request data
  - Guards and middleware can communicate cleanly via typed context
  - Aligns with the documented `ctx.set()`/`ctx.get()` API contract
- **Current workaround**: Use `(ctx.req as any).prop` for shared data, wrap in a helper like `getUser(ctx)` that reads from `req`.

## Working with HMR

KickJS uses Vite HMR via `kick dev`. Understanding what survives a hot reload vs what needs a cold restart saves debugging time.

### What survives HMR (safe to edit)
| What | Why |
|---|---|
| Controller logic | Routes re-mount on rebuild |
| Use case / service logic | DI resolves fresh instances |
| DTO / validation schemas | Re-evaluated on import |
| Guard / middleware logic | Re-registered with routes |
| Mongoose schemas | With `mongoose.models.X \|\|` guard pattern |
| Email templates / HTML | Re-evaluated on import |

### What breaks on HMR (needs full restart)
| What | Why | Symptom |
|---|---|---|
| Adapter options | `g.__app.rebuild()` reuses old adapters | Config changes don't take effect |
| Auth policy changes | Old AuthAdapter persists | `defaultPolicy` stuck on old value |
| New modules in array | Old app doesn't pick up new modules | New routes don't appear |
| New adapters in array | Old app doesn't pick up new adapters | New adapter not running |
| `@Job`/`@Service` processor classes | New class identity ≠ old DI binding | `No binding found for: EmailProcessor` |
| DevTools peer adapter refs | Old DevTools holds old references | `/_debug/queues` shows "not found" |

### Best practices
1. **Use `ctx.set()`/`ctx.get()` for shared per-request data** — fixed in KickJS v1.2.5 (issue #13 resolved). Use a helper:
   ```typescript
   // shared/utils/auth.ts
   export function getUser(ctx: RequestContext): AuthUser {
     const user = ctx.get<AuthUser>('user');
     if (!user) throw HttpException.unauthorized('Authentication required');
     return user;
   }
   ```

2. **Use `@Autowired()` over `@Inject(TOKEN)` for properties** — `@Inject` is for constructor params only. `@Autowired` resolves by class type which survives HMR better.

3. **Mongoose schemas must use the HMR guard**:
   ```typescript
   export const UserModel = (mongoose.models.User as mongoose.Model<UserDocument>)
     || mongoose.model<UserDocument>('User', userSchema);
   ```

4. **Ignore `No binding found` errors on reload** — cosmetic HMR artifact. Workers from cold boot keep running.

5. **Restart fully when changing**: adapter config, auth policy, modules array, adapters array, or queue processor classes.

6. **Keep `authBridgeMiddleware` on controllers** — it validates JWT independently of the AuthAdapter (which can't resolve `@Public()` routes due to `beforeRoutes` phase timing).

## Observations

- **DI container is singleton**: `Container.getInstance()` returns the same instance throughout the app lifecycle
- **`@Public()` decorator**: Must be imported from `@forinda/kickjs-auth`, not `@forinda/kickjs-core`
- **`buildRoutes()` function**: Must be imported from `@forinda/kickjs-http`
- **`@Autowired()` resolves by class type** — won't work for services registered under Symbol tokens (e.g., `MAILER`). Use constructor `@Inject(SYMBOL)` for those.
- **`ctx.paginate(fetcher, config)` calls `ctx.qs()` internally** — don't call both; use `ctx.paginate` which handles everything.
