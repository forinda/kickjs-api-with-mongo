# Building a Production-Grade Task Management API with KickJS

## A deep dive into scaffolding, authentication, real-time chat, SSE stats, and job queues with TypeScript's newest decorator-driven framework

---

I recently spent several weeks building **Vibed** — a Jira-like task management backend with workspaces, projects, tasks, real-time chat, file attachments, activity feeds, and live dashboard stats. The final result: **13 modules, 65 HTTP endpoints, 13 MongoDB collections**, a WebSocket chat system, SSE-powered live dashboards, and a BullMQ job queue for emails and notifications.

The framework I built it on is **KickJS** — a decorator-driven Node.js framework sitting on Express 5 and TypeScript. If you have used NestJS, the patterns will feel familiar. If you have been looking for something with fewer abstractions and a smaller dependency surface, this article is for you.

This is not a marketing post. I am going to show you the patterns that worked, the gotchas that cost me hours, and the architectural decisions that paid off. All the code you see here is from the actual codebase, not hypothetical examples.

---

## Why KickJS Over NestJS or Plain Express?

Three reasons made the decision for me:

1. **DDD-first project structure.** The CLI scaffolds `presentation/application/domain/infrastructure` layers per module out of the box. No debating folder structures with your team.

2. **Built-in support for things you always bolt on.** Swagger docs, WebSocket controllers, Server-Sent Events, BullMQ job queues, cron scheduling, mailer integration, and a dev tools dashboard — all as first-party packages.

3. **Minimal abstraction over Express.** KickJS does not hide Express. Your global middleware is still `(req, res, next)`. Your route handlers get a `RequestContext` wrapper, but you can drop down to `ctx.req` and `ctx.res` anytime. When something breaks, you debug Express, not a proprietary runtime.

The trade-off: KickJS is at v1.2.2. Documentation has gaps. Some APIs behave differently from what the docs describe. I will call out every case I hit.

---

## Scaffolding the Project

Getting started is one command:

```bash
kick new vibed --pm pnpm
```

This launches an interactive prompt for template selection — pick **REST API**. Then add the packages you need:

```bash
kick add auth ws mailer queue cron swagger devtools
```

> **Gotcha #1:** `kick new` always prompts interactively, even with flags. If you are scripting it in CI, pipe input: `echo "1" | kick new vibed --pm pnpm --no-git --install`.

The generated project structure follows DDD layers inside each module:

```
src/
├── config/
│   ├── adapters.ts       # Framework adapters (DB, auth, WS, queue, etc.)
│   ├── env.ts            # Typed environment variables
│   └── middleware.ts      # Global Express middleware
├── modules/
│   ├── tasks/
│   │   ├── domain/
│   │   │   ├── entities/task.entity.ts
│   │   │   └── repositories/task.repository.ts    # Interface
│   │   ├── application/
│   │   │   ├── dtos/create-task.dto.ts
│   │   │   └── use-cases/create-task.use-case.ts
│   │   ├── infrastructure/
│   │   │   ├── repositories/mongo-task.repository.ts
│   │   │   └── schemas/task.schema.ts
│   │   ├── presentation/
│   │   │   └── tasks.controller.ts
│   │   └── tasks.module.ts
│   └── ... (12 more modules)
├── shared/
│   ├── constants/tokens.ts
│   ├── constants/query-configs.ts
│   ├── constants/error-codes.ts
│   └── utils/auth.ts
└── index.ts
```

To generate a new module with all four layers:

```bash
kick g module comments
```

This gives you the skeleton. You fill in the domain logic.

---

## Core Patterns

### The Module

Every feature is a module. A module registers its dependencies in the DI container and declares its routes:

```typescript
import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
import { buildRoutes } from '@forinda/kickjs-http';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoTaskRepository } from './infrastructure/repositories/mongo-task.repository';
import { TasksController } from './presentation/tasks.controller';

export class TasksModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.TASK_REPOSITORY, () =>
      container.resolve(MongoTaskRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(TasksController),
      controller: TasksController,
    };
  }
}
```

Then register it in your modules array:

```typescript
export const modules: AppModuleClass[] = [
  AuthModule,
  UsersModule,
  WorkspacesModule,
  ProjectsModule,
  LabelsModule,
  TasksModule,
  CommentsModule,
  AttachmentsModule,
  ActivityModule,
  NotificationsModule,
  ChannelsModule,
  MessagesModule,
  StatsModule,
];
```

> **Gotcha #2:** `@Controller('/tasks')` combined with `path: '/tasks'` in `routes()` produces `/api/v1/tasks/tasks/...`. Use one or the other. I recommend `@Controller()` with no argument and let the module path handle routing, or do what we did — set `path: '/'` in the module and put the full path in each route decorator.

### The Controller

Controllers use decorators for routing, Swagger documentation, middleware, and DI — all in one place:

```typescript
@ApiTags('Tasks')
@ApiBearerAuth()
@Middleware(authBridgeMiddleware)
@Controller()
export class TasksController {
  @Autowired() private createTaskUseCase!: CreateTaskUseCase;
  @Autowired() private taskRepo!: MongoTaskRepository;

  @Post('/projects/:projectId/tasks', {
    params: z.object({ projectId: z.string() }),
    body: createTaskSchema,
  })
  @Middleware(projectAccessGuard)
  @ApiOperation({ summary: 'Create a new task in a project' })
  @ApiResponse({ status: 201, description: 'Task created successfully' })
  async create(ctx: RequestContext) {
    const user = getUser(ctx);
    const result = await this.createTaskUseCase.execute(
      ctx.params.projectId, user.id, ctx.body
    );
    ctx.created(successResponse(result, 'Task created'));
  }
}
```

A few things to notice:

- **`@Autowired()`** injects by class type. Use it for properties. Use `@Inject(TOKEN)` for constructor parameters when you need to inject by Symbol.
- **Zod schemas** are passed directly to the route decorator options. Validation happens automatically before your handler runs. Invalid requests get a 400 with structured errors.
- **`ctx.created()`**, **`ctx.json()`**, **`ctx.badRequest()`** — the `RequestContext` has convenience methods for every HTTP response pattern.

### Zod Validation on Routes

Define your DTOs as Zod schemas and pass them inline:

```typescript
import { z } from 'zod';

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10000).optional(),
  status: z.string().default('todo'),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).default('none'),
  assigneeIds: z.array(z.string()).default([]),
  labelIds: z.array(z.string()).default([]),
  parentTaskId: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  estimatePoints: z.number().int().min(0).optional(),
});
```

In the route:

```typescript
@Post('/projects/:projectId/tasks', {
  params: z.object({ projectId: z.string() }),
  body: createTaskSchema,
})
```

Params, query, and body are all validated. `ctx.body`, `ctx.params`, and `ctx.query` are fully typed from the schema. No runtime type assertions needed inside the handler.

### Pagination with `ctx.paginate()`

KickJS has a built-in paginate pattern that handles query string parsing, filtering, sorting, and response formatting:

```typescript
@Get('/projects/:projectId/tasks', {
  params: z.object({ projectId: z.string() }),
})
@ApiQueryParams(TASK_QUERY_CONFIG)
async list(ctx: RequestContext) {
  await ctx.paginate(
    async (parsed) => {
      parsed.filters.push({
        field: 'projectId', operator: 'eq', value: ctx.params.projectId,
      });
      return this.taskRepo.findPaginated(parsed);
    },
    TASK_QUERY_CONFIG,
  );
}
```

The query config is centralized so Swagger docs and controllers stay in sync:

```typescript
import type { ApiQueryParamsConfig } from '@forinda/kickjs-core';

export const TASK_QUERY_CONFIG: ApiQueryParamsConfig = {
  filterable: ['status', 'priority', 'assigneeId', 'labelId', 'projectId'],
  sortable: ['createdAt', 'title', 'priority', 'dueDate', 'orderIndex'],
  searchable: ['title', 'description'],
};
```

> **Gotcha #3:** The type is `ApiQueryParamsConfig`, not `QueryParamsConfig` as some docs reference. The latter does not exist in the package exports.

---

## Authentication

### The AuthAdapter Problem

KickJS ships an `AuthAdapter` with JWT strategy support and a `@Public()` decorator to mark open routes. In theory, you configure it once and protected routes just work.

In practice, I hit a wall. The `AuthAdapter` runs in the `beforeRoutes` lifecycle phase — before controllers are resolved. This means it cannot read `@Public()` metadata from controller methods because those classes have not been instantiated yet. The result: `defaultPolicy: 'protected'` blocks **everything**, including your login and register endpoints. Setting `defaultPolicy: 'open'` makes nothing protected.

**The solution: `authBridgeMiddleware`.** I wrote a standard KickJS middleware that handles JWT validation manually and applied it at the controller level with `@Middleware()`:

```typescript
export const authBridgeMiddleware: MiddlewareHandler = (ctx: RequestContext, next) => {
  if ((ctx.req as any).user) {
    ctx.set('user', (ctx.req as any).user);
    return next();
  }

  const authHeader = ctx.headers['authorization'] as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) {
    throw HttpException.unauthorized('Authentication required');
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as any;
    const user = {
      id: payload.sub,
      email: payload.email,
      globalRole: payload.globalRole ?? 'user',
    };
    (ctx.req as any).user = user;
    ctx.set('user', user);
  } catch {
    throw HttpException.unauthorized('Invalid or expired token');
  }

  next();
};
```

Protected controllers get `@Middleware(authBridgeMiddleware)` at the class level. Public controllers (like `AuthController` for login/register) simply do not use it.

### The `getUser()` Helper

Notice the middleware stores the user on **`ctx.req`**, not just `ctx.set()`. This is critical.

> **Gotcha #4:** `ctx.set()` and `ctx.get()` are **not shared** between middleware and handler. KickJS creates a separate `RequestContext` instance for each middleware and for the route handler. Each instance has its own private `metadata` Map. Data stored via `ctx.set()` in middleware is invisible to `ctx.get()` in the handler.

The workaround: store shared per-request data on `req` directly and read it through a helper:

```typescript
export function getUser(ctx: RequestContext): AuthUser {
  const user = (ctx.req as any).user as AuthUser | undefined;
  if (!user) {
    throw HttpException.unauthorized('Authentication required');
  }
  return user;
}
```

Every handler that needs the authenticated user calls `getUser(ctx)`. Clean, centralized, works reliably.

### Refresh Token Rotation

The auth module implements standard refresh token rotation — issue a short-lived access token (15 min) and a longer-lived refresh token (7 days). The `/refresh` endpoint validates the old refresh token, revokes it, and issues a new pair. The `/logout` endpoint invalidates the refresh token immediately.

---

## Real-Time Features

### WebSocket Chat

KickJS's `@forinda/kickjs-ws` package provides a decorator-driven WebSocket controller on top of Socket.IO:

```typescript
@WsController('/chat')
export class ChatWsController {
  @Autowired() private messageRepo!: MongoMessageRepository;

  @OnConnect()
  handleConnect(ctx: WsContext) {
    try {
      const token = ctx.data?.token || '';
      const payload = jwt.verify(token, env.JWT_SECRET) as any;
      ctx.set('userId', payload.sub);
      ctx.set('email', payload.email);
      onlineUsers.set(ctx.id, { userId: payload.sub, userName: payload.email });

      ctx.send('welcome', { id: ctx.id, userId: payload.sub });
      ctx.broadcastAll('presence:online', {
        userId: payload.sub, userName: payload.email,
      });
    } catch {
      ctx.send('error', { message: 'Invalid authentication token' });
    }
  }

  @OnMessage('message:send')
  async handleSend(ctx: WsContext) {
    const userId = ctx.get('userId');
    if (!userId) return ctx.send('error', { message: 'Not authenticated' });

    const { channelId, content } = ctx.data || {};
    if (!channelId || !content) return;

    const message = await this.messageRepo.create({
      channelId: channelId as any,
      senderId: userId as any,
      content,
      mentions: [],
    });

    const payload = {
      messageId: message._id.toString(),
      channelId,
      senderId: userId,
      content: message.content,
      createdAt: message.createdAt,
    };

    ctx.to(`channel:${channelId}`).send('message:new', payload);
    ctx.send('message:new', payload);
  }
}
```

Notice that **`ctx.set()`/`ctx.get()` does work within WebSocket contexts** — unlike HTTP `RequestContext`, the `WsContext` maintains state for the entire connection lifecycle. Clients authenticate once on connect, and `ctx.get('userId')` is available in every subsequent message handler.

The WS controller also handles `channel:join`, `channel:leave`, typing indicators, message editing, and message deletion — all persisted to MongoDB and broadcast to room members.

### SSE Live Stats

For dashboard widgets that need live updates without the overhead of a persistent WebSocket, we used Server-Sent Events. KickJS makes this surprisingly clean:

```typescript
@Get('/projects/:projectId/stats/live', {
  params: z.object({ projectId: z.string() }),
})
@Middleware(projectAccessGuard)
async projectLive(ctx: RequestContext) {
  const sse = ctx.sse();
  const projectId = ctx.params.projectId;

  const sendStats = async () => {
    const tasksByStatus = await this.taskRepo.countByStatus(projectId);
    const totalTasks = Object.values(tasksByStatus).reduce((s, c) => s + c, 0);
    const doneTasks = tasksByStatus['done'] ?? 0;
    const completionRate = totalTasks > 0
      ? Math.round((doneTasks / totalTasks) * 100)
      : 0;

    sse.send({
      tasksByStatus, totalTasks, completionRate,
      timestamp: new Date().toISOString(),
    }, 'stats:update');
  };

  await sendStats();
  const interval = setInterval(sendStats, 10000);
  sse.onClose(() => clearInterval(interval));
}
```

Call `ctx.sse()` and you get an SSE writer. Call `sse.send(data, eventName)` to push events. Call `sse.onClose()` to clean up when the client disconnects. That is the entire API.

---

## Background Jobs

### BullMQ + Redis

The `QueueAdapter` connects to Redis and manages named queues:

```typescript
const queueAdapter = new QueueAdapter({
  redis: {
    host: redisUrl.hostname,
    port: Number(redisUrl.port) || 6379,
    password: redisUrl.password || undefined,
  },
  queues: ['email', 'notifications', 'activity'],
  concurrency: 5,
});
```

> **Gotcha #5:** The `queues` option takes **string names**, not processor classes. The docs show `queues: [EmailProcessor]` but the actual type is `string[]`. Passing classes causes `TypeError: name.includes is not a function` at runtime.

### Job Processors

Processor classes use `@Job` and `@Process` decorators:

```typescript
@Service()
@Job('email')
export class EmailProcessor {
  @Autowired(MAILER) private mailer!: MailerService;

  @Process('send-welcome-email')
  async sendWelcome(job: BullMQJob<{ email: string; firstName: string }>) {
    await this.mailer.send({
      to: job.data.email,
      subject: `Welcome to Vibed, ${job.data.firstName}!`,
      html: `<h1>Welcome!</h1><p>Hi ${job.data.firstName}, your account is ready.</p>`,
    });
  }

  @Process('send-overdue-reminder')
  async sendOverdueReminder(job: BullMQJob<{ email: string; taskKey: string }>) {
    // ...
  }
}
```

To enqueue a job from anywhere:

```typescript
await queueService.add('email', 'send-welcome-email', {
  email: user.email,
  firstName: user.firstName,
});
```

### Cron Jobs

Scheduled jobs use the `@Cron` decorator with standard cron syntax:

```typescript
@Service()
export class TaskCronJobs {
  @Cron('0 9 * * *', { description: 'Send overdue task reminders', timezone: 'UTC' })
  async overdueReminders() {
    const container = Container.getInstance();
    const taskRepo = container.resolve<ITaskRepository>(TOKENS.TASK_REPOSITORY);
    const queueService = container.resolve<QueueService>(TOKENS.QUEUE_SERVICE);

    const overdueTasks = await taskRepo.findOverdue();
    for (const task of overdueTasks) {
      for (const assigneeId of task.assigneeIds) {
        const user = await userRepo.findById(assigneeId.toString());
        if (user) {
          await queueService.add('email', 'send-overdue-reminder', {
            email: user.email,
            taskKey: task.key,
            taskTitle: task.title,
          });
        }
      }
    }
  }
}
```

### Mail Provider Switching

One pattern I liked: swap mail providers based on environment without touching any business logic.

```typescript
new MailerAdapter({
  provider: env.NODE_ENV === 'production'
    ? new ResendMailProvider(env.RESEND_API_KEY)
    : new ConsoleProvider(),
  defaultFrom: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_EMAIL },
}),
```

In development, emails print to the console. In production, they go through Resend. Processors do not know or care.

---

## File Uploads

KickJS provides a `@FileUpload` decorator that handles multipart parsing:

```typescript
@Post('/tasks/:taskId/attachments', {
  params: z.object({ taskId: z.string() }),
})
@FileUpload({
  mode: 'single',
  fieldName: 'file',
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: ['image/*', 'application/pdf', 'text/*', 'application/zip'],
})
async create(ctx: RequestContext) {
  const file = ctx.file;
  if (!file) return ctx.badRequest('No file uploaded. Use field name "file".');

  const base64Data = file.buffer.toString('base64');
  const attachment = await this.attachmentRepo.create({
    taskId: ctx.params.taskId as any,
    uploadedById: getUser(ctx).id as any,
    fileName: file.originalname,
    fileSize: file.size,
    mimeType: file.mimetype,
    base64Data,
  });

  ctx.created(successResponse({
    id: attachment._id.toString(),
    fileName: attachment.fileName,
    fileSize: attachment.fileSize,
  }));
}
```

For downloads, decode the base64 and stream it back:

```typescript
@Get('/attachments/:attachmentId/download')
async download(ctx: RequestContext) {
  const attachment = await this.attachmentRepo.findById(ctx.params.attachmentId);
  if (!attachment) throw HttpException.notFound(ErrorCode.ATTACHMENT_NOT_FOUND);

  const buffer = Buffer.from(attachment.base64Data, 'base64');
  ctx.res.setHeader('Content-Type', attachment.mimeType);
  ctx.res.setHeader('Content-Disposition', `attachment; filename="${attachment.fileName}"`);
  ctx.res.setHeader('Content-Length', buffer.length.toString());
  ctx.res.end(buffer);
}
```

> **Note:** Storing files as base64 in MongoDB works fine for a project management tool where attachments are typically under 10MB. For a media-heavy application, you would want GridFS or an object store like S3.

---

## Lessons Learned and Gotchas

This section is why I wrote this article. These are the things that cost me real debugging time, and none of them are in the docs.

**1. Mongoose models need an HMR guard.** `kick dev` uses Vite HMR. Mongoose schema files that call `mongoose.model()` at the top level throw `OverwriteModelError` on the second hot reload. Every schema file must use:

```typescript
export const TaskModel =
  (mongoose.models.Task as mongoose.Model<TaskDocument>) ||
  mongoose.model<TaskDocument>('Task', taskSchema);
```

**2. `@Controller('/path')` + module `path` causes double prefix.** Explained above. Use one or the other.

**3. Global middleware uses Express `(req, res, next)`, not `(ctx, next)`.** The `bootstrap({ middleware: [...] })` array accepts raw Express handlers. Only `@Middleware` decorators on controllers use `RequestContext`. Mixing them up crashes at runtime with `Cannot set properties of undefined`.

**4. `ctx.set()`/`ctx.get()` NOT shared between middleware and handler.** Each gets a separate `RequestContext` instance with its own private `metadata` Map. Store shared data on `req` directly.

**5. `@Inject(TOKEN)` is for constructor params, `@Autowired()` is for properties.** They are not interchangeable. `@Autowired()` resolves by class type. `@Inject(SYMBOL)` resolves by token. Use `@Autowired(MAILER)` with a token when injecting a property by Symbol.

**6. `QueueAdapter.queues` expects string names, not classes.** Passing classes causes a BullMQ runtime error.

**7. Modules without routes crash Express.** If your module only has queue processors or cron jobs and no HTTP routes, do not register it in the modules array. Import processor files as side-effects from your adapters config instead. We built a `ProcessorRegistrarAdapter` to handle this:

```typescript
export class ProcessorRegistrarAdapter implements AppAdapter {
  name = 'ProcessorRegistrarAdapter';

  beforeStart(_app: any, container: Container) {
    if (!container.has(EmailProcessor)) {
      container.register(EmailProcessor, EmailProcessor);
    }
  }
}
```

**8. `defaultPolicy: 'protected'` blocks everything.** The `AuthAdapter` cannot resolve `@Public()` decorators because it runs before controllers are instantiated. Either use `defaultPolicy: 'open'` and add auth middleware manually (what we did), or accept that every route needs the auth header.

**9. `ApiQueryParamsConfig`, not `QueryParamsConfig`.** The docs reference a type that does not exist.

**10. `loadEnv()` loses type info.** The `defineEnv` generic uses `z.ZodObject<any>`, which erases your schema shape. You need an explicit type assertion:

```typescript
const _env = loadEnv(envSchema);
export const env = _env as {
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
  MONGODB_URI: string;
  JWT_SECRET: string;
  // ... all your fields
};
```

---

## Architecture Recap

Here is what the final Vibed backend looks like by the numbers:

| Metric | Count |
|---|---|
| Modules | 13 (+ 2 non-HTTP: queue, cron) |
| HTTP routes | 65 |
| MongoDB collections | 13 |
| WebSocket event handlers | 8 |
| SSE endpoints | 3 |
| Queue processors | 3 (email, notifications, activity) |
| Cron jobs | 4 (overdue reminders, daily digest, token cleanup, presence cleanup) |
| Adapters | 9 (Mongoose, Redis, WS, Mailer, Queue, Cron, Swagger, DevTools, ProcessorRegistrar) |

The DDD layer pattern worked well. I never wondered where to put something:

- **Domain layer:** entities and repository interfaces. Zero framework imports.
- **Application layer:** DTOs (Zod schemas) and use cases. Depends only on domain interfaces.
- **Infrastructure layer:** Mongoose schemas, repository implementations, external API clients.
- **Presentation layer:** Controllers. Depends on application layer use cases and infrastructure repos.

Centralized constants were essential at this scale. `TOKENS` holds all DI symbols. `QUERY_CONFIGS` keeps Swagger and controller pagination in sync. `ERROR_CODES` gives every error a machine-readable code.

---

## What's Next

In the next article, I will cover testing — unit tests for use cases, integration tests for repositories, and end-to-end API tests hitting all 65 endpoints with Vitest.

If you want to explore KickJS, the docs are at [kickjs.dev](https://kickjs.dev). The framework is young but moving fast, and the decorator-driven DX is genuinely productive once you learn the handful of gotchas I covered here.

The honest summary: **KickJS gave us 80% of what NestJS offers with 20% of the abstraction.** For a team that wants DDD structure with escape hatches to raw Express, it is a compelling choice. Just keep this article bookmarked for when you hit the gotchas.

---

*If you found this useful, follow me for the next part where we write tests for the entire API. Questions? Drop them in the comments — I have been deep in this codebase and happy to share what I learned.*
