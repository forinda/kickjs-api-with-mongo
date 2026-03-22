---
title: "Building a Jira-Like Task API with KickJS — Auth, WebSocket Chat, SSE, Queues & More"
published: false
description: "How I built a 65-endpoint task management backend with KickJS — a decorator-driven TypeScript framework. Real code, real gotchas, real lessons."
tags: kickjs, typescript, nodejs, webdev
series: "Building with KickJS"
cover_image: ""
---

## TL;DR

- 🏗️ Built a full Jira-like task management API (65 endpoints, 17 modules) using **KickJS** — a decorator-driven TypeScript framework
- 🔐 Auth with JWT + refresh tokens + role-based guards — and the debugging rabbit hole that came with it
- 💬 Real-time WebSocket chat with rooms, typing indicators, and read receipts
- 📡 Server-Sent Events for live dashboard updates on task changes
- ⚡ Background job queues with BullMQ for emails, reminders, and audit logs
- 🤕 10 gotchas that cost me hours so they don't have to cost you hours

---

## Why This Exists

I wanted to stress-test [KickJS](https://github.com/AtotheY/kickjs) beyond a "Hello World." So I built **Vibed** — a task management backend with categories, labels, sprints, comments, file attachments, real-time chat, SSE dashboards, background jobs, and cron-scheduled reminders.

Think Jira's API, but TypeScript-native, decorator-driven, and built in a weekend (okay, a long weekend).

Let's walk through the interesting parts.

---

## The Stack

| Concern | Tool |
|---|---|
| Framework | KickJS (Express under the hood) |
| Database | MongoDB + Mongoose |
| Auth | JWT access + refresh tokens |
| Email | Resend SDK |
| Real-time | WebSocket (native ws) |
| Live updates | Server-Sent Events |
| Job queue | BullMQ + Redis |
| Scheduled tasks | Cron module |
| Docs | Swagger / OpenAPI |

---

## Getting Started

KickJS has a CLI that scaffolds everything:

```bash
kick new vibed --pm pnpm
kick add auth ws mailer queue cron swagger devtools
kick g module tasks
```

That last command generates a full DDD module — controller, service, repository, DTOs, the works. More on that structure in a sec.

---

## The DDD Module Pattern

Every feature in KickJS lives in a **module**. Each module follows a layered architecture:

```
src/modules/tasks/
├── task.module.ts          # Wires everything together
├── task.controller.ts      # HTTP routes + decorators
├── task.service.ts         # Business logic
├── task.repository.ts      # Mongoose queries
├── dto/
│   ├── create-task.dto.ts  # Validation schemas
│   └── update-task.dto.ts
├── schemas/
│   └── task.schema.ts      # Mongoose model
└── interfaces/
    └── task.interface.ts   # TypeScript types
```

Here's what a module registration looks like:

```typescript
@Module({
  controllers: [TaskController],
  providers: [TaskService, TaskRepository],
  imports: [MongooseModule.forFeature([
    { name: 'Task', schema: TaskSchema }
  ])],
})
export class TaskModule {}
```

And a typical controller:

```typescript
@Controller('/tasks')
@UseGuards(AuthGuard)
export class TaskController {
  @Autowired() private taskService!: TaskService;

  @Get('/')
  async findAll(ctx: Context) {
    const user = getUser(ctx);
    const query = ctx.query as ApiQueryParamsConfig;
    const tasks = await this.taskService.findByWorkspace(
      user.workspaceId,
      query
    );
    return ctx.json({ data: tasks });
  }

  @Post('/')
  @Validate(CreateTaskDto)
  async create(ctx: Context) {
    const user = getUser(ctx);
    const body = ctx.body as CreateTaskDto;
    const task = await this.taskService.create({
      ...body,
      createdBy: user._id,
      workspaceId: user.workspaceId,
    });
    return ctx.json({ data: task }, 201);
  }
}
```

Clean. Predictable. Every module follows the same shape.

---

## Authentication — The Hard Way

This section is a debugging story. Buckle up.

### Chapter 1: @Public() Didn't Work

KickJS ships with an auth module that has a `defaultPolicy: 'RESTRICTED'` setting. Every route is locked down by default — which is great, until you need public routes.

The `@Public()` decorator is supposed to mark routes as open. Except... it wasn't working. Every public route still returned `401 Unauthorized`.

After digging through the source, I found the issue: the `resolveHandler` in the auth config was throwing before the `@Public()` metadata could be checked. The auth middleware runs **globally**, and when `resolveHandler` fails, it short-circuits.

### Chapter 2: The Bridge Middleware

Solution? I built `authBridgeMiddleware` — a global middleware that sits *before* the auth guard:

```typescript
export function authBridgeMiddleware(
  ctx: Context,
  next: NextFunction
) {
  const token = ctx.headers.authorization?.split(' ')[1];

  if (!token) {
    ctx.set('user', null);
    return next();
  }

  try {
    const payload = verifyAccessToken(token);
    ctx.set('user', payload);
  } catch {
    ctx.set('user', null);
  }

  return next();
}
```

This way, the auth guard always has a user (or `null`) to work with, and `@Public()` routes can proceed even without a token.

### Chapter 3: The ctx.set()/ctx.get() Trap

Here's the gotcha that burned the most time:

```typescript
// In middleware:
ctx.set('user', payload);  // ✅ Sets on THIS context

// In route handler:
const user = ctx.get('user');  // ❌ UNDEFINED
```

`ctx.set()` and `ctx.get()` in KickJS **do not share state** between global middleware and route handlers the way you'd expect. The context object gets reconstructed.

The fix was a helper that reads from the right place:

```typescript
export function getUser(ctx: Context): AuthUser {
  const user = ctx.get('user') ?? (ctx as any)._locals?.user;

  if (!user) {
    throw new UnauthorizedException('Not authenticated');
  }

  return user;
}
```

Not pretty. But it works everywhere.

---

## Real-Time Chat with WebSocket

KickJS has first-class WebSocket support via `@WsController`:

```typescript
@WsController('/chat')
export class ChatGateway {
  @Autowired() private chatService!: ChatService;

  @OnConnect()
  async handleConnect(socket: WsSocket) {
    const user = await this.authenticateSocket(socket);
    socket.data = { userId: user._id };
    console.log(`🟢 ${user.name} connected`);
  }

  @OnMessage('join-room')
  async handleJoinRoom(
    socket: WsSocket,
    payload: { roomId: string }
  ) {
    socket.join(payload.roomId);
    socket.to(payload.roomId).emit('user-joined', {
      userId: socket.data.userId,
      timestamp: new Date(),
    });
  }

  @OnMessage('send-message')
  async handleMessage(
    socket: WsSocket,
    payload: { roomId: string; content: string }
  ) {
    const message = await this.chatService.create({
      roomId: payload.roomId,
      senderId: socket.data.userId,
      content: payload.content,
    });

    socket.to(payload.roomId).emit('new-message', message);
  }

  @OnMessage('typing')
  async handleTyping(
    socket: WsSocket,
    payload: { roomId: string; isTyping: boolean }
  ) {
    socket.to(payload.roomId).emit('user-typing', {
      userId: socket.data.userId,
      isTyping: payload.isTyping,
    });
  }
}
```

Rooms, typing indicators, message persistence — all decorator-driven. The `socket.join()` / `socket.to()` API mirrors Socket.IO, which makes it easy to reason about.

---

## Live Dashboard with SSE

For the dashboard, I didn't want WebSocket overhead. SSE is perfect for one-way server-to-client updates:

```typescript
@Get('/stream')
@UseGuards(AuthGuard)
async streamUpdates(ctx: Context) {
  const user = getUser(ctx);

  ctx.sse((send, close) => {
    const interval = setInterval(async () => {
      const stats = await this.dashboardService.getStats(
        user.workspaceId
      );
      send({ event: 'dashboard-update', data: stats });
    }, 5000);

    ctx.req.on('close', () => {
      clearInterval(interval);
      close();
    });
  });
}
```

`ctx.sse()` handles the headers (`text/event-stream`, `Cache-Control`, etc.) and gives you a clean `send`/`close` interface. The client just uses `EventSource`:

```javascript
const es = new EventSource('/api/dashboard/stream', {
  headers: { Authorization: `Bearer ${token}` }
});

es.addEventListener('dashboard-update', (e) => {
  updateDashboard(JSON.parse(e.data));
});
```

---

## Background Jobs That Actually Work

Email notifications, reminder scheduling, audit logging — all of this needs to happen off the request cycle. KickJS wraps BullMQ:

```typescript
@Job('email-queue')
export class EmailJob {
  @Autowired() private mailer!: MailerService;

  @Process('send-welcome')
  async handleWelcome(job: JobData<WelcomePayload>) {
    await this.mailer.send({
      to: job.data.email,
      subject: 'Welcome to Vibed!',
      template: 'welcome',
      context: { name: job.data.name },
    });
  }

  @Process('send-reminder')
  async handleReminder(job: JobData<ReminderPayload>) {
    await this.mailer.send({
      to: job.data.email,
      subject: `Reminder: ${job.data.taskTitle}`,
      template: 'task-reminder',
      context: job.data,
    });
  }
}
```

Dispatching a job from anywhere:

```typescript
@Autowired() private queueService!: QueueService;

async createTask(data: CreateTaskDto) {
  const task = await this.taskRepo.create(data);

  // Fire-and-forget background job
  await this.queueService.add('email-queue', 'send-reminder', {
    email: data.assigneeEmail,
    taskTitle: task.title,
    dueDate: task.dueDate,
  });

  return task;
}
```

**Pro tip:** In development, skip Redis entirely with the `ConsoleProvider`:

```typescript
QueueModule.register({
  provider: process.env.NODE_ENV === 'development'
    ? 'console'    // Logs jobs to terminal
    : 'bullmq',   // Real Redis-backed queue
  connection: { host: 'localhost', port: 6379 },
})
```

---

## File Uploads → Base64 → MongoDB

No S3, no Cloudinary. For a task management MVP, storing files as base64 in MongoDB is fine:

```typescript
@Post('/attachments')
@FileUpload({ maxSize: 5 * 1024 * 1024 }) // 5MB
async uploadAttachment(ctx: Context) {
  const file = ctx.file;
  const user = getUser(ctx);

  const attachment = await this.attachmentService.create({
    taskId: ctx.params.taskId,
    fileName: file.originalname,
    mimeType: file.mimetype,
    data: file.buffer.toString('base64'),
    uploadedBy: user._id,
  });

  return ctx.json({ data: attachment }, 201);
}
```

Is this production-ready for large files? No. Is it perfect for an MVP with < 5MB attachments? Absolutely.

---

## 10 Gotchas That'll Save You Hours

These are the things I wish someone had told me before I started. Each one cost me at least 30 minutes of head-scratching.

### 1. Mongoose HMR Guard

Hot module reload re-runs your schema definitions. Mongoose hates that.

```typescript
// ❌ Crashes on HMR
export const TaskModel = model('Task', TaskSchema);

// ✅ Guard it
export const TaskModel =
  models.Task || model('Task', TaskSchema);
```

### 2. Double-Slash Routes

If your module prefix is `/api` and your controller has `@Controller('/tasks')`, you get `/api//tasks`. Both start with `/`.

```typescript
// ❌ Results in /api//tasks
@Module({ prefix: '/api' })
@Controller('/tasks')

// ✅ Drop the leading slash on one
@Module({ prefix: '/api' })
@Controller('tasks')
```

### 3. Global vs Route Middleware Signatures

Global middleware gets `(ctx, next)`. Route middleware gets `(ctx, next)` too — but the `ctx` object is different. Global middleware runs on the raw Express context; route middleware runs on the KickJS-wrapped context.

```typescript
// Global middleware — req/res under the hood
app.use((ctx, next) => {
  ctx.req.headers; // ✅ works
  ctx.body;        // ❌ might not be parsed yet
  next();
});

// Route middleware — full KickJS context
@UseMiddleware(myMiddleware)
// ctx.body ✅, ctx.query ✅, ctx.params ✅
```

### 4. ctx.set/get NOT Shared Across Middleware/Handler

Already covered this one above. Use the `getUser(ctx)` helper pattern or `res.locals`.

### 5. @Inject for Constructors, @Autowired for Properties

```typescript
// Constructor injection
class TaskService {
  constructor(@Inject(TaskRepository) private repo: TaskRepository) {}
}

// Property injection (no constructor needed)
class TaskController {
  @Autowired() private taskService!: TaskService;
}
```

Mix them up and you get silent `undefined` values. Pick one pattern per class.

### 6. QueueAdapter Wants String Names, Not Classes

```typescript
// ❌ Nope
this.queueService.add(EmailJob, 'send-welcome', data);

// ✅ String name matching @Job('email-queue')
this.queueService.add('email-queue', 'send-welcome', data);
```

### 7. Route-less Modules Crash Express

If a module has no controllers (e.g., a pure service module), KickJS still tries to register it as a router. Empty router = Express crash.

```typescript
// ✅ Add a health controller or use forRoot() pattern
@Module({
  controllers: [],  // This can cause issues
  providers: [MyService],
})

// ✅ Better: export the service from a module that HAS routes
```

### 8. Auth defaultPolicy Blocks When resolveHandler Fails

If your `resolveHandler` throws, *every* route gets a 401 — even `@Public()` ones. Always wrap it:

```typescript
authConfig({
  defaultPolicy: 'RESTRICTED',
  resolveHandler: async (ctx) => {
    try {
      return await verifyToken(ctx);
    } catch {
      return null;  // Let @Public() routes through
    }
  },
})
```

### 9. ApiQueryParamsConfig Type Name

The type for pagination/filter/sort query params is called `ApiQueryParamsConfig`, not `QueryParams`, not `ApiQuery`, not `PaginationOptions`. Ask me how many times I searched for the wrong name.

```typescript
import { ApiQueryParamsConfig } from '@kickjs/core';

@Get('/')
async findAll(ctx: Context) {
  const query = ctx.query as ApiQueryParamsConfig;
  // query.page, query.limit, query.sort, query.filter
}
```

### 10. loadEnv() Type Erasure

`loadEnv()` returns `Record<string, string>`. Everything is a string. Your "boolean" `ENABLE_SWAGGER=true` is the *string* `"true"`.

```typescript
// ❌ This is always truthy (it's a non-empty string)
if (env.ENABLE_SWAGGER) { ... }

// ✅ Compare strings explicitly
if (env.ENABLE_SWAGGER === 'true') { ... }

// ✅ Or parse once at startup
const config = {
  enableSwagger: env.ENABLE_SWAGGER === 'true',
  port: parseInt(env.PORT, 10) || 3000,
};
```

---

## The Numbers

After a long weekend of building:

| Metric | Count |
|---|---|
| Modules | 17 |
| API Endpoints | 65 |
| MongoDB Collections | 13 |
| TypeScript Files | 159 |
| Type Errors | 0 |

Modules include: auth, users, workspaces, projects, sprints, tasks, task-comments, task-labels, task-categories, task-attachments, task-reminders, chat, notifications, dashboard, audit-log, file-uploads, and health.

---

## What I'd Do Differently

1. **Start with the auth bridge middleware** — don't fight `@Public()` for two hours first
2. **Use property injection everywhere** — `@Autowired()` is simpler than constructor `@Inject()`
3. **String-based queue names from day one** — saves a refactor later
4. **Build the `getUser(ctx)` helper immediately** — you'll call it in every single guarded route

---

## What's Next

In the next article in this series, I'll cover:

- **Role-based access control** — workspace admins vs members vs viewers
- **Advanced query filtering** — how to build a flexible filter/sort/paginate layer on top of Mongoose
- **Deployment** — containerizing the whole stack with Docker Compose

If you've been looking for a **NestJS alternative** that's lighter, faster to scaffold, and doesn't require a PhD in dependency injection — give KickJS a shot.

{% cta https://github.com/AtotheY/kickjs %} Star KickJS on GitHub {% endcta %}

---

*Got questions? Drop them in the comments — I'll answer everything. If you hit any of these gotchas yourself, I'd love to hear your war stories too.*
