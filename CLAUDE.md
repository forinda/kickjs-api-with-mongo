# CLAUDE.md — Project Context for Claude Code

## Project
Vibed — Jira-like task management backend built with KickJS v1.2.6 (decorator-driven Node.js framework on Express 5 + TypeScript).

## Tech Stack
- **Framework**: KickJS v1.2.6 — `@forinda/kickjs-*` packages
- **Database**: MongoDB via Mongoose
- **Auth**: JWT (custom `authBridgeMiddleware`, NOT the AuthAdapter's route-level auth)
- **Email**: Resend (prod) / ConsoleProvider (dev) via `@forinda/kickjs-mailer`
- **Real-time**: WebSocket via `@forinda/kickjs-ws`, SSE via `ctx.sse()`
- **Queues**: BullMQ + Redis via `@forinda/kickjs-queue`
- **Cron**: `@forinda/kickjs-cron`
- **Docs**: Swagger via `@forinda/kickjs-swagger`

## Key Files
- `src/index.ts` — Entry point (clean, delegates to config/)
- `src/config/adapters.ts` — All adapter configurations
- `src/config/middleware.ts` — Global Express middleware
- `src/config/env.ts` — Zod env validation
- `src/modules/index.ts` — Module registry
- `src/shared/constants/tokens.ts` — DI Symbol tokens
- `src/shared/constants/query-configs.ts` — Pagination/filter configs
- `src/shared/utils/auth.ts` — `getUser(ctx)` helper
- `framework-issues.md` — Known framework issues and workarounds
- `agents.md` — Full project guide for agents and developers

## Critical Rules

### Authentication
- AuthAdapter is `defaultPolicy: 'open'` — it does NOT protect routes
- `authBridgeMiddleware` handles JWT validation — apply via `@Middleware(authBridgeMiddleware)` on protected controllers
- Auth controller (register/login/refresh) has NO `authBridgeMiddleware`
- Read user with `getUser(ctx)` from `@/shared/utils/auth` — uses `ctx.get<AuthUser>('user')` internally (fixed in KickJS v1.2.6)

### DI Injection
- Controllers: `@Autowired()` for property injection (resolves by class type)
- Use cases: `@Inject(TOKENS.X)` in CONSTRUCTOR params for interface-based repos
- `@Inject(TOKEN)` does NOT work on properties — only constructor params
- For framework services under Symbol tokens (MAILER, QUEUE_MANAGER): use constructor `@Inject(SYMBOL)`

### Mongoose HMR Safety
ALL schema files MUST use:
```typescript
export const UserModel = (mongoose.models.User as mongoose.Model<UserDocument>)
  || mongoose.model<UserDocument>('User', userSchema);
```

### Module Structure (DDD)
```
module/
├── module.ts              # register(container) + routes()
├── presentation/          # Controllers
├── application/dtos/      # Zod schemas
├── application/use-cases/ # Business logic
├── domain/entities/       # TypeScript interfaces
├── domain/repositories/   # Repository interfaces
└── infrastructure/
    ├── schemas/           # Mongoose schemas
    └── repositories/      # Mongo implementations
```

### Pagination
Use `ctx.paginate(fetcher, CONFIG)` — NOT `ctx.qs()` separately. Config constants in `shared/constants/query-configs.ts`. Add `@ApiQueryParams(CONFIG)` for Swagger.

### Route Paths
- Module `routes()` sets the mount path (e.g., `path: '/users'`)
- Controller uses `@Controller()` with NO path arg — otherwise paths double
- Modules with `path: '/'` produce routes like `/api/v1/tasks/:taskId`

### Adding New Endpoints
1. Create DTO with Zod in `application/dtos/`
2. Create use case in `application/use-cases/` with `@Service()` + `@Inject()` constructor
3. Add `@Autowired()` in controller + route decorator + Swagger decorators
4. Register repository in module's `register()` if new

### Modules Without Routes (Queue/Cron)
Cannot be added to the modules array — Express crashes on `undefined` router. Import processors as side-effects in `config/adapters.ts` instead.

## Commands
```bash
kick dev              # Dev server (Vite HMR)
kick build            # Production build
kick g module <name>  # Generate DDD module
kick g controller <n> # Generate controller
kick g dto <name>     # Generate Zod DTO
```

## HMR — What Needs Full Restart
- Adapter config changes (auth policy, redis, queue names)
- New modules/adapters added to arrays
- Queue processor class changes

## Resources
- KickJS Docs: https://forinda.github.io/kick-js/
- KickJS Source: /home/forinda/dev/personal/kick-js
- KickJS Examples: /home/forinda/dev/personal/kick-js/examples/
- Framework Issues: ./framework-issues.md
- Project Guide: ./agents.md
