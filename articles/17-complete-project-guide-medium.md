Published on Medium

# Building a Complete Jira-like Task Management Backend with KickJS — From Scaffold to Production

*The comprehensive guide to building Vibed: a 65+ endpoint task management backend with KickJS, MongoDB, Redis, BullMQ, Socket.IO, and SSE. Covers auth, DDD modules, real-time features, background jobs, pagination, database seeding, and framework contributions.*

***

## TL;DR

This is the complete project guide for Vibed — a Jira-like task management backend built with KickJS v1.2.7. It covers everything from initial scaffold to production-ready features: 14 modules, 65+ endpoints, real-time WebSocket chat, SSE live dashboards, BullMQ background jobs, cron scheduling, and the framework issues we filed along the way.

If you've been following the article series, this brings it all together. If you're starting here, this is everything you need to build a non-trivial backend with KickJS.

> *This article is part of the "Building with KickJS" series, where we build a production-grade task management backend from scratch. Each article in the series covers a specific aspect of the architecture — this one ties everything together as the complete reference guide.*

***

## 1. Project Overview and Tech Stack

Vibed is a task management platform modeled after Jira's API surface. It supports workspaces, projects, task boards with drag-and-drop reordering, comments with @mentions, file attachments, real-time chat channels, live dashboard stats, email notifications, and activity feeds.

- **Framework**: KickJS v1.2.2 (`@forinda/kickjs-*` packages)
- **Language**: TypeScript (ESM)
- **Database**: MongoDB via Mongoose 9
- **Cache / Queue broker**: Redis (ioredis)
- **Background jobs**: BullMQ
- **Auth**: JWT (access + refresh token rotation), bcryptjs
- **Email**: Resend (production) / ConsoleProvider (development)
- **Real-time**: WebSocket chat (Socket.IO via WsAdapter)
- **Live updates**: Server-Sent Events via `ctx.sse()`
- **Scheduled jobs**: CronAdapter (overdue reminders, daily digest, token cleanup, presence cleanup)
- **API docs**: Swagger via SwaggerAdapter
- **Dev tools**: DevToolsAdapter at `/_debug/*`
- **Build**: Vite + SWC
- **Package manager**: pnpm

KickJS is a decorator-driven Node.js framework built on Express 5. It uses TypeScript decorators for routing (`@Get`, `@Post`), dependency injection (`@Service`, `@Inject`, `@Autowired`), validation (`@Validate` with Zod), and documentation (`@ApiTags`, `@ApiOperation`). If you've used NestJS, the patterns will feel familiar — but KickJS is lighter, uses Express directly, and emphasizes convention over configuration.

***

## 2. Project Setup

### Scaffolding

```bash
kick new vibed --pm pnpm
kick add auth ws mailer queue cron swagger devtools
```

The first command scaffolds a KickJS project with the REST template. The second adds adapter packages for auth, WebSocket, email, queues, cron, Swagger, and dev tools.

### Module Generation

```bash
kick g module tasks
kick g module workspaces
kick g module comments
# ... repeat for each module
```

Each `kick g module` creates the full DDD directory structure:

```
module/
├── <name>.module.ts              # AppModule: register() + routes()
├── presentation/
│   └── <name>.controller.ts      # @Controller, @Get, @Post, etc.
├── application/
│   ├── dtos/                     # Zod validation schemas
│   └── use-cases/                # Single-purpose business logic classes
├── domain/
│   ├── entities/                 # TypeScript interfaces
│   └── repositories/            # Repository interfaces
└── infrastructure/
    ├── schemas/                  # Mongoose schemas + models
    └── repositories/            # Mongo repository implementations
```

### Environment Configuration with Zod

All environment variables are validated at startup via Zod:

```typescript
// src/config/env.ts
import { z } from 'zod';
import { defineEnv, loadEnv } from '@forinda/kickjs-config';

const envSchema = defineEnv((base) =>
  base.extend({
    MONGODB_URI: z.string().url(),
    REDIS_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    RESEND_API_KEY: z.string().min(1),
    MAIL_FROM_NAME: z.string().default('Vibed'),
    MAIL_FROM_EMAIL: z.string().email(),
    APP_URL: z.string().url(),
    APP_NAME: z.string().default('Vibed'),
  }),
);

export const env = loadEnv(envSchema);
```

If any required variable is missing or invalid, the app fails fast at startup with a clear Zod validation error. No more "undefined is not a function" errors 10 minutes into runtime because `REDIS_URL` was misspelled.

### Entry Point

The entry point is deliberately minimal — all configuration is delegated to dedicated files:

```typescript
// src/index.ts
import 'reflect-metadata';
import { bootstrap } from '@forinda/kickjs-http';
import { modules } from './modules';
import { adapters } from './config/adapters';
import { middleware } from './config/middleware';

bootstrap({
  modules,
  apiPrefix: '/api',
  defaultVersion: 1,
  middleware,
  adapters,
});
```

Global middleware uses Express signatures (not KickJS `RequestContext`):

```typescript
// src/config/middleware.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestIdMiddleware } from '@/shared/presentation/middlewares/request-id.middleware';

export const middleware = [
  requestIdMiddleware,
  cors(),
  helmet(),
  express.json({ limit: '5mb' }),
  express.urlencoded({ extended: true }),
];
```

***

## 3. Authentication: JWT with Refresh Rotation

### The Auth Controller

Auth endpoints are public — no `authBridgeMiddleware`:

```typescript
@ApiTags('Auth')
@Controller()
export class AuthController {
  @Autowired() private registerUseCase!: RegisterUseCase;
  @Autowired() private loginUseCase!: LoginUseCase;
  @Autowired() private refreshTokenUseCase!: RefreshTokenUseCase;
  @Autowired() private logoutUseCase!: LogoutUseCase;

  @Post('/register', { body: registerSchema })
  @Public()
  @ApiOperation({ summary: 'Register a new user account' })
  async register(ctx: RequestContext) {
    const result = await this.registerUseCase.execute(ctx.body);
    ctx.created(successResponse(result, 'Registration successful'));
  }

  @Post('/login', { body: loginSchema })
  @Public()
  async login(ctx: RequestContext) {
    const result = await this.loginUseCase.execute(ctx.body);
    ctx.json(successResponse(result, 'Login successful'));
  }

  @Post('/refresh', { body: refreshTokenSchema })
  @Public()
  async refresh(ctx: RequestContext) {
    const result = await this.refreshTokenUseCase.execute(ctx.body);
    ctx.json(successResponse(result));
  }
}
```

DTOs are Zod schemas:

```typescript
// register.dto.ts
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
});

// login.dto.ts
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
```

### The Auth Bridge Middleware

Every protected controller uses `authBridgeMiddleware` at the class level:

```typescript
// src/shared/presentation/middlewares/auth-bridge.middleware.ts
export const authBridgeMiddleware: MiddlewareHandler = (ctx: RequestContext, next) => {
  const user = (ctx.req as any).user;
  if (user) {
    ctx.set('user', user);
  }
  next();
};
```

The `AuthAdapter` with `JwtStrategy` validates the JWT and puts the user on `req.user`. The bridge middleware copies it to `ctx` metadata so handlers can use `ctx.get('user')` or the `getUser()` helper.

### The getUser Helper

```typescript
// src/shared/utils/auth.ts
export function getUser(ctx: RequestContext): AuthUser {
  const user = ctx.get<AuthUser>('user');
  if (!user) throw HttpException.unauthorized('Authentication required');
  return user;
}
```

Every controller that needs the current user calls `getUser(ctx)` instead of accessing context directly. This abstraction saved us when the framework fixed the `ctx.set/get` sharing bug in v1.2.5 — one file changed, zero controllers touched.

### Guards

Role-based access uses guard middleware that composes with `authBridgeMiddleware`:

```typescript
// src/shared/guards/workspace-membership.guard.ts
export const workspaceMembershipGuard: MiddlewareHandler = async (ctx, next) => {
  const user = ctx.get('user');
  if (!user) throw HttpException.unauthorized('Authentication required');

  const workspaceId = ctx.params.workspaceId;
  if (!workspaceId) return next();

  const container = Container.getInstance();
  const memberRepo = container.resolve<IWorkspaceMemberRepository>(
    TOKENS.WORKSPACE_MEMBER_REPOSITORY,
  );
  const member = await memberRepo.findByUserAndWorkspace(user.id, workspaceId);

  if (!member) throw HttpException.forbidden(ErrorCode.NOT_WORKSPACE_MEMBER);

  ctx.set('workspaceMember', member);
  next();
};
```

Guards resolve repositories from the DI container at request time via `Container.getInstance()`. This avoids circular dependency issues that arise when guards depend on repositories that depend on modules.

***

## 4. Core Modules: DDD Structure Walkthrough

### The Module Registry

All modules are registered in `src/modules/index.ts`:

```typescript
import type { AppModuleClass } from '@forinda/kickjs-core';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { CommentsModule } from './comments/comments.module';
import { LabelsModule } from './labels/labels.module';
import { ChannelsModule } from './channels/channels.module';
import { MessagesModule } from './messages/messages.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ActivityModule } from './activity/activity.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { StatsModule } from './stats/stats.module';
import { QueueModule } from './queue/queue.module';

export const modules: AppModuleClass[] = [
  QueueModule,
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

### Tasks Module — A Complete Walkthrough

The tasks module is the most feature-rich. Let me walk through each layer.

**Module registration** maps the DI token to the concrete repository:

```typescript
// src/modules/tasks/tasks.module.ts
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

The `path: '/'` means routes are mounted at the API root. The controller defines the full paths: `/projects/:projectId/tasks`, `/tasks/:taskId`, etc.

**Mongoose schema** with HMR guard:

```typescript
// src/modules/tasks/infrastructure/schemas/task.schema.ts
const taskSchema = new Schema<TaskDocument>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    key: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String },
    status: { type: String, default: 'todo' },
    priority: { type: String, enum: ['critical', 'high', 'medium', 'low', 'none'], default: 'none' },
    assigneeIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    labelIds: [{ type: Schema.Types.ObjectId, ref: 'Label' }],
    parentTaskId: { type: Schema.Types.ObjectId, ref: 'Task' },
    dueDate: { type: Date },
    estimatePoints: { type: Number },
    orderIndex: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// HMR guard — REQUIRED for Vite dev server
export const TaskModel =
  (mongoose.models.Task as mongoose.Model<TaskDocument>) ||
  mongoose.model<TaskDocument>('Task', taskSchema);
```

Without the HMR guard, every file save that triggers a re-import crashes with `OverwriteModelError`.

**Use case** with constructor DI injection:

```typescript
// src/modules/tasks/application/use-cases/create-task.use-case.ts
@Service()
export class CreateTaskUseCase {
  constructor(
    @Inject(TOKENS.TASK_REPOSITORY) private taskRepo: ITaskRepository,
    @Inject(TOKENS.PROJECT_REPOSITORY) private projectRepo: IProjectRepository,
  ) {}

  async execute(projectId: string, userId: string, dto: CreateTaskDto) {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new Error('Project not found');

    const counter = await this.projectRepo.incrementTaskCounter(projectId);
    const key = `${project.key}-${counter}`;

    const maxOrderTask = await this.taskRepo.findByProject(projectId);
    const maxOrder = maxOrderTask.length > 0
      ? Math.max(...maxOrderTask.filter(t => t.status === dto.status).map(t => t.orderIndex))
      : -1;

    return this.taskRepo.create({
      ...dto,
      projectId: projectId as any,
      workspaceId: project.workspaceId,
      key,
      reporterId: userId as any,
      orderIndex: maxOrder + 1,
    });
  }
}
```

The task key pattern (`PROJ-1`, `PROJ-2`, etc.) mirrors Jira's issue keys. `incrementTaskCounter` atomically increments a counter on the project document to ensure uniqueness.

**Controller** with property injection via `@Autowired()`:

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
    const user = ctx.get('user');
    const result = await this.createTaskUseCase.execute(ctx.params.projectId, user.id, ctx.body);
    ctx.created(successResponse(result, 'Task created'));
  }

  @Get('/projects/:projectId/tasks', {
    params: z.object({ projectId: z.string() }),
  })
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
}
```

### DI Pattern Summary

- **Controller properties** — `@Autowired()`: Concrete classes (use cases, repos)
- **Use case constructor** — `@Inject(TOKENS.X)`: Interface-based repos via Symbol tokens
- **Processor constructor** — `@Inject(MAILER)`: Framework service symbols
- **Module `register()`** — `container.registerFactory()`: Mapping tokens to implementations

Critical rule: `@Inject(TOKEN)` only works on constructor parameters. `@Autowired()` only works on properties (resolves by class type). Mixing them up causes silent failures.

***

## 5. Supporting Modules

### Labels

Workspace-scoped label CRUD. Labels can be attached to tasks via `labelIds`. Nothing complex — standard CRUD with `workspaceMembershipGuard`.

### Comments

Comment CRUD with @mention parsing. Creating a comment triggers a notification job via BullMQ. The `@mention` pattern is parsed from the comment content and stored as a `mentions` array on the comment document.

### Attachments

File upload using multipart form data. Files are converted to base64 and stored in MongoDB (not ideal for production, but keeps the stack simple). The controller increments `task.attachmentCount` for denormalized display.

### Notifications

In-app notification system. Notifications are created by background jobs (not directly by controllers). Endpoints: list paginated, mark as read, mark all as read, unread count. The unread count endpoint is what the frontend polls for the notification badge.

***

## 6. Real-Time: WebSocket Chat and SSE Stats

### WebSocket Chat

The `ChatWsController` handles real-time messaging via Socket.IO rooms:

```typescript
@WsController('/chat')
export class ChatWsController {
  @Autowired() private messageRepo!: MongoMessageRepository;

  @OnConnect()
  handleConnect(ctx: WsContext) {
    const token = ctx.data?.token || '';
    const payload = jwt.verify(token, env.JWT_SECRET) as any;
    ctx.set('userId', payload.sub);
    onlineUsers.set(ctx.id, { userId: payload.sub, userName: payload.email });
    ctx.broadcastAll('presence:online', { userId: payload.sub, userName: payload.email });
  }

  @OnMessage('channel:join')
  handleJoin(ctx: WsContext) {
    const channelId = ctx.data?.channelId;
    ctx.join(`channel:${channelId}`);
    ctx.to(`channel:${channelId}`).send('channel:user_joined', {
      channelId,
      userId: ctx.get('userId'),
    });
  }

  @OnMessage('channel:typing')
  handleTyping(ctx: WsContext) {
    const { channelId } = ctx.data || {};
    const info = onlineUsers.get(ctx.id);
    ctx.to(`channel:${channelId}`).send('channel:typing', {
      channelId,
      userId: ctx.get('userId'),
      userName: info?.userName,
    });
  }

  @OnMessage('message:send')
  async handleSend(ctx: WsContext) {
    const userId = ctx.get('userId');
    const { channelId, content } = ctx.data || {};

    const message = await this.messageRepo.create({
      channelId, senderId: userId, content, mentions: [],
    });

    const payload = {
      messageId: message._id.toString(),
      channelId,
      senderId: userId,
      content: message.content,
      createdAt: message.createdAt,
    };

    ctx.to(`channel:${channelId}`).send('message:new', payload);
    ctx.send('message:new', payload); // Echo to sender
  }
}
```

WebSocket events: `channel:join`, `channel:leave`, `message:send`, `message:edit`, `message:delete`, `channel:typing`, `channel:stop_typing`.

REST endpoints handle message history and editing: `GET /channels/:channelId/messages`, `PATCH /messages/:messageId`, `DELETE /messages/:messageId`.

### SSE Live Stats

The stats module uses `ctx.sse()` for server-pushed updates:

```typescript
@Controller()
@Middleware(authBridgeMiddleware)
export class StatsController {
  @Autowired() private taskRepo!: MongoTaskRepository;

  @Get('/projects/:projectId/stats/live')
  @Middleware(projectAccessGuard)
  async projectLive(ctx: RequestContext) {
    const sse = ctx.sse();
    const projectId = ctx.params.projectId;

    const sendStats = async () => {
      const tasksByStatus = await this.taskRepo.countByStatus(projectId);
      const totalTasks = Object.values(tasksByStatus).reduce((sum, c) => sum + c, 0);
      const doneTasks = tasksByStatus['done'] ?? 0;
      const completionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

      sse.send({ tasksByStatus, totalTasks, completionRate }, 'stats:update');
    };

    await sendStats();
    const interval = setInterval(sendStats, 10000);
    sse.onClose(() => clearInterval(interval));
  }
}
```

SSE endpoints: workspace live stats, project live stats, workspace activity live.

***

## 7. Background Jobs: BullMQ Processors

### Queue Configuration

```typescript
// src/config/adapters.ts
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

### Email Processor

```typescript
@Service()
@Job('email')
export class EmailProcessor {
  @Autowired(MAILER) private mailer!: MailerService;

  @Process('send-welcome-email')
  async sendWelcome(job: BullMQJob<{ email: string; firstName: string }>) {
    logger.info(`Sending welcome email to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: `Welcome to Vibed, ${job.data.firstName}!`,
      html: `<h1>Welcome to Vibed!</h1><p>Hi ${job.data.firstName}, your account is ready.</p>`,
    });
  }

  @Process('send-task-assigned')
  async sendTaskAssigned(job: BullMQJob<{ email: string; taskKey: string; taskTitle: string }>) {
    await this.mailer.send({
      to: job.data.email,
      subject: `You were assigned to ${job.data.taskKey}: ${job.data.taskTitle}`,
      html: `<p>You were assigned to <strong>${job.data.taskKey}</strong></p>`,
    });
  }

  @Process('send-overdue-reminder')
  async sendOverdueReminder(job: BullMQJob<{ email: string; taskKey: string; dueDate: string }>) {
    await this.mailer.send({
      to: job.data.email,
      subject: `Overdue: ${job.data.taskKey}`,
      html: `<p>Task ${job.data.taskKey} was due on ${job.data.dueDate}</p>`,
    });
  }
}
```

The `QueueModule` imports processors as side-effects so `@Job()` decorators register in the job registry:

```typescript
// src/modules/queue/queue.module.ts
import './infrastructure/processors/email.processor';
import './infrastructure/processors/notification.processor';
import './infrastructure/processors/activity.processor';

export class QueueModule implements AppModule {
  register(_container: Container): void {
    // QueueAdapter v1.2.6+ auto-registers @Job classes
  }

  routes(): ModuleRoutes | null {
    return null; // No HTTP routes
  }
}
```

### Cron Jobs

```typescript
@Service()
export class PresenceCronJobs {
  @Cron('*/5 * * * *', { description: 'Clean up stale presence entries' })
  async cleanupPresence() {
    logger.info('Running presence cleanup...');
  }
}
```

Cron services are registered in the `CronAdapter`, not in the modules array:

```typescript
new CronAdapter({
  services: [TaskCronJobs, DigestCronJobs, CleanupCronJobs, PresenceCronJobs, HealthCheckCronJobs],
  enabled: true,
});
```

***

## 8. Pagination: ctx.paginate and Query Configs

### Defining Query Configs

All query configurations are centralized in `shared/constants/query-configs.ts`:

```typescript
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
```

### Using ctx.paginate

The controller passes a fetcher function and the config to `ctx.paginate()`:

```typescript
@Get('/projects/:projectId/tasks')
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

`ctx.paginate()` calls `ctx.qs()` internally to parse query string parameters, then calls the fetcher with the parsed result. The response includes pagination metadata:

```json
{
  "data": [...],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### Query Helpers

Repositories use helper functions to convert parsed query params to Mongoose operations:

```typescript
export function buildMongoFilter(
  filters: Array<{ field: string; operator: string; value: string }>,
): Record<string, any> {
  const mongoFilter: Record<string, any> = {};
  for (const { field, operator, value } of filters) {
    switch (operator) {
      case 'eq': mongoFilter[field] = value; break;
      case 'neq': mongoFilter[field] = { $ne: value }; break;
      case 'in': mongoFilter[field] = { $in: value.split(',') }; break;
      case 'contains': mongoFilter[field] = { $regex: value, $options: 'i' }; break;
      // ... gt, gte, lt, lte, between, starts, ends
    }
  }
  return mongoFilter;
}

export function buildMongoSort(
  sort: Array<{ field: string; direction: 'asc' | 'desc' }>,
): Record<string, 1 | -1> {
  const mongoSort: Record<string, 1 | -1> = {};
  for (const { field, direction } of sort) {
    mongoSort[field] = direction === 'asc' ? 1 : -1;
  }
  if (Object.keys(mongoSort).length === 0) mongoSort.createdAt = -1;
  return mongoSort;
}
```

***

## 9. DI Tokens

All DI Symbol tokens are centralized in one file:

```typescript
// src/shared/constants/tokens.ts
export const TOKENS = {
  USER_REPOSITORY: Symbol('UserRepository'),
  REFRESH_TOKEN_REPOSITORY: Symbol('RefreshTokenRepository'),
  WORKSPACE_REPOSITORY: Symbol('WorkspaceRepository'),
  WORKSPACE_MEMBER_REPOSITORY: Symbol('WorkspaceMemberRepository'),
  PROJECT_REPOSITORY: Symbol('ProjectRepository'),
  TASK_REPOSITORY: Symbol('TaskRepository'),
  COMMENT_REPOSITORY: Symbol('CommentRepository'),
  LABEL_REPOSITORY: Symbol('LabelRepository'),
  CHANNEL_REPOSITORY: Symbol('ChannelRepository'),
  MESSAGE_REPOSITORY: Symbol('MessageRepository'),
  NOTIFICATION_REPOSITORY: Symbol('NotificationRepository'),
  ACTIVITY_REPOSITORY: Symbol('ActivityRepository'),
  ATTACHMENT_REPOSITORY: Symbol('AttachmentRepository'),
  PRESENCE_SERVICE: Symbol('PresenceService'),
  QUEUE_SERVICE: Symbol('QueueService'),
} as const;
```

***

## 10. Full Module Structure

```
src/
├── index.ts                          # Entry point
├── config/
│   ├── env.ts                        # Zod env validation
│   ├── adapters.ts                   # All adapter configurations
│   └── middleware.ts                  # Global Express middleware
├── shared/
│   ├── constants/
│   │   ├── tokens.ts                 # DI Symbol tokens
│   │   ├── error-codes.ts            # Error code enum
│   │   └── query-configs.ts          # Pagination configs
│   ├── guards/
│   │   ├── workspace-membership.guard.ts
│   │   ├── project-access.guard.ts
│   │   └── channel-membership.guard.ts
│   ├── presentation/middlewares/
│   │   ├── auth-bridge.middleware.ts
│   │   └── request-id.middleware.ts
│   ├── utils/
│   │   └── auth.ts                   # getUser(ctx) helper
│   └── infrastructure/
│       ├── database/
│       │   ├── mongoose.adapter.ts
│       │   └── query-helpers.ts
│       ├── redis/
│       │   └── redis.config.ts
│       └── mail/
│           └── resend.provider.ts
└── modules/
    ├── index.ts                      # Module registry
    ├── auth/                         # Register, login, refresh, logout
    ├── users/                        # Profile CRUD
    ├── workspaces/                   # CRUD + membership + invite
    ├── projects/                     # CRUD + board view
    ├── tasks/                        # CRUD + status/priority/assignees/reorder
    ├── comments/                     # CRUD + @mention parsing
    ├── labels/                       # Workspace-scoped label CRUD
    ├── channels/                     # Chat channel CRUD + membership
    ├── messages/                     # REST history + WebSocket chat
    ├── notifications/                # In-app notifications + unread count
    ├── activity/                     # Activity feed
    ├── attachments/                  # File upload
    ├── stats/                        # SSE live dashboards
    ├── queue/                        # BullMQ processors
    └── cron/                         # Scheduled jobs
```

***

## 11. API Endpoint Summary

Base prefix: `/api/v1`

### Auth (`/api/v1/auth`) — No auth required

```
METHOD  PATH                                    DESCRIPTION
------  ------                                  -----------
POST    /register                               Register new user
POST    /login                                  Login with credentials
POST    /refresh                                Refresh JWT token pair
POST    /logout                                 Logout (invalidate refresh)
```

### Users (`/api/v1/users`)

```
METHOD  PATH                                    DESCRIPTION
------  ------                                  -----------
GET     /me                                     Current user profile
PATCH   /me                                     Update profile
GET     /:id                                    Get user by ID
GET     /                                       List users (paginated)
```

### Workspaces (`/api/v1/workspaces`)

```
METHOD  PATH                                    DESCRIPTION
------  ------                                  -----------
POST    /                                       Create workspace
GET     /                                       List user's workspaces
GET     /:workspaceId                           Get workspace
PATCH   /:workspaceId                           Update workspace
DELETE  /:workspaceId                           Delete workspace
POST    /:workspaceId/invite                    Invite member
GET     /:workspaceId/members                   List members
PATCH   /:workspaceId/members/:userId           Update member role
DELETE  /:workspaceId/members/:userId           Remove member
POST    /:workspaceId/leave                     Leave workspace
```

### Projects (`/api/v1`)

```
METHOD  PATH                                    DESCRIPTION
------  ------                                  -----------
POST    /workspaces/:workspaceId/projects       Create project
GET     /workspaces/:workspaceId/projects       List projects
GET     /projects/:projectId                    Get project
PATCH   /projects/:projectId                    Update project
DELETE  /projects/:projectId                    Delete project
GET     /projects/:projectId/board              Board view
```

### Tasks (`/api/v1`)

```
METHOD  PATH                                    DESCRIPTION
------  ------                                  -----------
POST    /projects/:projectId/tasks              Create task
GET     /projects/:projectId/tasks              List tasks (paginated)
GET     /tasks/:taskId                          Get task
PATCH   /tasks/:taskId                          Update task
DELETE  /tasks/:taskId                          Delete task
PATCH   /tasks/:taskId/status                   Change status
PATCH   /tasks/:taskId/assignees                Update assignees
POST    /tasks/:taskId/reorder                  Reorder in column
GET     /tasks/:taskId/subtasks                 List subtasks
```

### Comments (`/api/v1`)

```
METHOD  PATH                                    DESCRIPTION
------  ------                                  -----------
POST    /tasks/:taskId/comments                 Create comment
GET     /tasks/:taskId/comments                 List comments
PATCH   /comments/:commentId                    Update comment
DELETE  /comments/:commentId                    Delete comment
```

### Labels (`/api/v1`)

```
METHOD  PATH                                    DESCRIPTION
------  ------                                  -----------
POST    /workspaces/:workspaceId/labels         Create label
GET     /workspaces/:workspaceId/labels         List labels
PATCH   /labels/:labelId                        Update label
DELETE  /labels/:labelId                        Delete label
```

### Attachments (`/api/v1`)

```
METHOD  PATH                                    DESCRIPTION
------  ------                                  -----------
POST    /tasks/:taskId/attachments              Upload
GET     /tasks/:taskId/attachments              List
GET     /attachments/:attachmentId              Metadata
GET     /attachments/:attachmentId/download     Download
DELETE  /attachments/:attachmentId              Delete
```

### Channels (`/api/v1`)

```
METHOD  PATH                                    DESCRIPTION
------  ------                                  -----------
POST    /workspaces/:workspaceId/channels       Create channel
GET     /workspaces/:workspaceId/channels       List channels
GET     /channels/:channelId                    Get channel
DELETE  /channels/:channelId                    Delete channel
POST    /channels/:channelId/members            Add member
DELETE  /channels/:channelId/members/:userId    Remove member
```

### Messages (`/api/v1`)

```
METHOD  PATH                                    DESCRIPTION
------  ------                                  -----------
GET     /channels/:channelId/messages           Message history
PATCH   /messages/:messageId                    Edit message
DELETE  /messages/:messageId                    Delete message
```

### Notifications (`/api/v1/notifications`)

```
METHOD  PATH                                    DESCRIPTION
------  ------                                  -----------
GET     /                                       List (paginated)
PATCH   /:id/read                               Mark as read
POST    /read-all                               Mark all as read
GET     /unread-count                           Unread count
```

### Activity (`/api/v1`)

```
METHOD  PATH                                    DESCRIPTION
------  ------                                  -----------
GET     /workspaces/:workspaceId/activity       Workspace activity
GET     /projects/:projectId/activity           Project activity
GET     /tasks/:taskId/activity                 Task activity
```

### Stats — SSE (`/api/v1`)

```
METHOD  PATH                                    DESCRIPTION
------  ------                                  -----------
GET     /workspaces/:workspaceId/stats/live     SSE workspace stats
GET     /projects/:projectId/stats/live         SSE project stats
GET     /workspaces/:workspaceId/activity/live  SSE activity stream
```

### WebSocket (`/ws/chat`)

```
EVENT                DIRECTION          DESCRIPTION
-----                ---------          -----------
channel:join         Client -> Server   Join room
channel:leave        Client -> Server   Leave room
message:send         Client -> Server   Send message
message:edit         Client -> Server   Edit message
message:delete       Client -> Server   Delete message
channel:typing       Client -> Server   Typing indicator
channel:stop_typing  Client -> Server   Stop typing
```

***

## 12. Framework Issues and Contributing Back

We tracked 18 framework issues in `framework-filed-issues/` — 13 bug reports, 1 documentation issue, and 4 feature requests. Seven issues were fixed across four KickJS releases (v1.2.3, v1.2.5, v1.2.6, v1.2.7).

Key issues and their resolutions:

- **KICK-003** — Modules without routes crash Express. *Resolution*: v1.2.3: `routes()` can return `null`
- **KICK-009** — `ctx.set/get` not shared across middleware/handler. *Resolution*: v1.2.5: Metadata Map stored on `req`
- **KICK-016** — `@Service + @Job` not auto-registered in DI. *Resolution*: v1.2.6: QueueAdapter auto-registers
- **KICK-017** — `@Service()` should mean auto-DI-registration. *Resolution*: v1.2.7: Container.bootstrap() scans

The feedback loop that made this work: discover the bug during development, build a workaround, file a detailed issue with a suggested fix, validate the upstream fix, remove the workaround, update the docs.

***

## 13. What's Next

Features planned but not yet implemented:

### Typed API Client (KICK-018)
A `kick generate:client` command that produces a tRPC-like typed client from the existing route decorators and Zod DTOs. All the metadata exists — it just needs to be surfaced to a client generator.

### Subtask CRUD
The task schema already has `parentTaskId`. Full subtask CRUD (create, list, reparent, delete) is the next module addition.

### Forgot Password Flow
The email processor already has `send-password-reset`. The missing piece is the auth controller endpoint (`POST /auth/forgot-password`) and a time-limited reset token stored in Redis.

### Redis-Backed Presence
The current in-memory `onlineUsers` Map works for single-instance deployments. For horizontal scaling, presence needs to move to Redis with the `@socket.io/redis-adapter`.

### Full-Text Search Upgrade
The current `$text` search works but is limited. Moving to MongoDB Atlas Search or Elasticsearch would enable fuzzy matching, typo tolerance, and field-weighted ranking.

***

## Quick Reference

### Commands

```bash
kick dev              # Dev server with Vite HMR
kick build            # Production build
kick start            # Run production build
kick g module <name>  # Generate DDD module scaffold
kick g controller <n> # Generate controller
kick g dto <name>     # Generate Zod DTO
```

### What Survives HMR

- Controller logic, use cases, DTOs, guards, middleware, Mongoose schemas (with guard)

### What Needs Full Restart

- Adapter config changes, new modules in array, new adapters, queue processor class changes

### Key File Paths

```
FILE                                    PURPOSE
----                                    -------
src/index.ts                            Entry point
src/config/adapters.ts                  All adapter configurations
src/config/env.ts                       Zod env validation
src/modules/index.ts                    Module registry
src/shared/constants/tokens.ts          DI Symbol tokens
src/shared/constants/query-configs.ts   Pagination configs
src/shared/utils/auth.ts               getUser(ctx) helper
src/shared/guards/                      Access control guards
framework-filed-issues/                 Framework issue tracker
```

***

*This is the final article in the "Building with KickJS" series. The full project source is available on GitHub. If you build something with KickJS, I'd genuinely like to hear about it.*

***

### About the Author

*Full-stack developer building developer tools and backend systems with TypeScript. Creator of KickJS, a decorator-driven Node.js framework. Passionate about clean architecture, DDD patterns, and developer experience. Follow for more deep dives into backend engineering and framework design.*
