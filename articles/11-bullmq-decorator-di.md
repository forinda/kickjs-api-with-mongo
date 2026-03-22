---
title: "BullMQ Job Processors with KickJS Decorator-Based DI — and Why Auto-Registration Matters"
description: "How I built a decorator-driven BullMQ job processing system in a Node.js backend, fought DI registration bugs for days, and finally got auto-registration working in KickJS v1.2.6."
tags: ["kickjs", "nodejs", "typescript", "mongodb", "bullmq"]
canonical_url: ""
published: false
cover_image: ""
---

# BullMQ Job Processors with Decorator-Based DI — and Why Auto-Registration Matters

Every backend eventually outgrows synchronous request handling. For Vibed, our Jira-like task management app, that moment arrived when I tried to send a welcome email inside a registration endpoint and the response time jumped from 120ms to 2.4 seconds. The answer was obvious: background jobs. The implementation, however, taught me more about decorator metadata, DI containers, and framework internals than I expected.

This is the story of integrating BullMQ with KickJS's decorator-based dependency injection, the registration bug that haunted me for a week, and how the framework eventually fixed it upstream.

## The Setup: QueueAdapter in KickJS

KickJS provides a `QueueAdapter` that wraps BullMQ with a decorator-driven API. You configure it in your adapter list alongside your database, auth, and other infrastructure:

```typescript
// src/config/adapters.ts
import { QueueAdapter } from '@forinda/kickjs-queue';
import { env } from './env';

const redisUrl = new URL(env.REDIS_URL);

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

The `queues` array declares which named queues your app uses. Each name maps to a BullMQ `Queue` instance on the producer side and a `Worker` instance on the consumer side. The `concurrency` value sets how many jobs each worker processes in parallel.

The adapter also exposes a `QueueService` that you inject elsewhere to dispatch jobs:

```typescript
import { QUEUE_MANAGER, type QueueService } from '@forinda/kickjs-queue';
```

That `QUEUE_MANAGER` is a Symbol token. More on why that matters later.

## The @Job + @Process Pattern

KickJS's queue package gives you two decorators: `@Job('queueName')` to bind a class to a named queue, and `@Process('jobName')` to mark individual methods as handlers for specific job types.

Here is the email processor from Vibed, which handles seven distinct job types on a single queue:

```typescript
// src/modules/queue/infrastructure/processors/email.processor.ts
import { Service, Logger, Autowired } from '@forinda/kickjs-core';
import { Job, Process } from '@forinda/kickjs-queue';
import type { Job as BullMQJob } from 'bullmq';
import { MAILER, type MailerService } from '@forinda/kickjs-mailer';

const logger = Logger.for('EmailProcessor');

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
      html: `<h1>Welcome to Vibed!</h1>
             <p>Hi ${job.data.firstName}, your account is ready.</p>`,
    });
  }

  @Process('send-task-assigned')
  async sendTaskAssigned(
    job: BullMQJob<{
      email: string;
      taskKey: string;
      taskTitle: string;
      assignerName: string;
    }>
  ) {
    logger.info(`Sending task assigned email to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: `You were assigned to ${job.data.taskKey}: ${job.data.taskTitle}`,
      html: `<p>${job.data.assignerName} assigned you to
             <strong>${job.data.taskKey}</strong>: ${job.data.taskTitle}</p>`,
    });
  }

  @Process('send-mentioned')
  async sendMentioned(
    job: BullMQJob<{ email: string; taskKey: string; mentionedBy: string }>
  ) {
    logger.info(`Sending mention email to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: `You were mentioned in ${job.data.taskKey}`,
      html: `<p>${job.data.mentionedBy} mentioned you in a comment on
             <strong>${job.data.taskKey}</strong></p>`,
    });
  }

  @Process('send-overdue-reminder')
  async sendOverdueReminder(
    job: BullMQJob<{
      email: string;
      taskKey: string;
      taskTitle: string;
      dueDate: string;
    }>
  ) {
    logger.info(`Sending overdue reminder to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: `Overdue: ${job.data.taskKey} - ${job.data.taskTitle}`,
      html: `<p>Task <strong>${job.data.taskKey}</strong>:
             ${job.data.taskTitle} was due on ${job.data.dueDate}</p>`,
    });
  }

  @Process('send-password-reset')
  async sendPasswordReset(
    job: BullMQJob<{ email: string; resetUrl: string }>
  ) {
    logger.info(`Sending password reset to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: 'Reset your password',
      html: `<p>Click <a href="${job.data.resetUrl}">here</a>
             to reset your password.</p>`,
    });
  }

  @Process('send-workspace-invite')
  async sendWorkspaceInvite(
    job: BullMQJob<{
      email: string;
      workspaceName: string;
      inviterName: string;
    }>
  ) {
    logger.info(`Sending workspace invite to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: `You've been invited to ${job.data.workspaceName}`,
      html: `<p>${job.data.inviterName} invited you to join
             <strong>${job.data.workspaceName}</strong> on Vibed.</p>`,
    });
  }

  @Process('send-daily-digest')
  async sendDailyDigest(
    job: BullMQJob<{ email: string; summary: string }>
  ) {
    logger.info(`Sending daily digest to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: 'Your Daily Vibed Digest',
      html: job.data.summary,
    });
  }
}
```

A few things to notice:

1. **One class, one queue, many handlers.** The `@Job('email')` decorator at the class level means every `@Process` method inside handles jobs from the `email` queue. The process name maps to the job name you pass when dispatching.

2. **Full type safety on job data.** Each `@Process` method receives a typed `BullMQJob<T>` generic, so `job.data` is fully typed. No guessing what fields are available.

3. **DI via `@Autowired(MAILER)`.** The mailer service is injected using a Symbol token. This is the same `MailerService` configured by the `MailerAdapter` in the adapter list. In development, it resolves to a `ConsoleProvider` that logs emails to stdout. In production, it resolves to our Resend provider.

## Dispatching Jobs from Use Cases

The other side of the equation is dispatching. In Vibed, use cases inject `QueueService` and call `add()`:

```typescript
// src/modules/auth/application/use-cases/register.use-case.ts
import { Service, Inject, HttpException, Logger } from '@forinda/kickjs-core';
import { QUEUE_MANAGER, type QueueService } from '@forinda/kickjs-queue';
import { TOKENS } from '@/shared/constants/tokens';
import type { IUserRepository } from '@/modules/users/domain/repositories/user.repository';
import type { RegisterDto } from '../dtos/register.dto';

@Service()
export class RegisterUseCase {
  constructor(
    @Inject(TOKENS.USER_REPOSITORY) private userRepo: IUserRepository,
    @Inject(QUEUE_MANAGER) private queueService: QueueService,
  ) {}

  async execute(dto: RegisterDto) {
    // ... create user, generate tokens ...

    // Queue welcome email (non-blocking)
    try {
      await this.queueService.add('email', 'send-welcome-email', {
        email: user.email,
        firstName: user.firstName,
      }, { delay: 5000 });
    } catch (err) {
      logger.warn('Failed to queue welcome email — continuing registration');
    }

    return { user, accessToken, refreshToken };
  }
}
```

The API is `queueService.add(queueName, jobName, data, options?)`. The queue name matches what you declared in the `QueueAdapter` config and in the `@Job` decorator. The job name matches the `@Process` decorator on the handler method. BullMQ options like `delay`, `attempts`, and `backoff` pass through directly.

Notice the `try/catch` around `queueService.add()`. If Redis is momentarily unreachable, I do not want registration to fail. The welcome email is nice to have, not mission-critical. This is a pattern I use throughout: wrap queue dispatches in try/catch and log warnings on failure.

## The DI Registration Problem

Here is where things got interesting. The decorators looked clean, the code compiled, and the server started without errors. But when a user registered, the welcome email never sent. No error in the processor. No error in the use case. The job just vanished into the queue and was never consumed.

After hours of debugging, I figured out what was happening. BullMQ workers were starting, but the `EmailProcessor` class was being instantiated with `new EmailProcessor()` by the queue adapter -- not resolved from the DI container. That meant `@Autowired(MAILER)` never ran. The `mailer` property was `undefined`. The job handler threw a silent `Cannot read properties of undefined (reading 'send')` that BullMQ caught and retried until max attempts.

The root cause: **`@Service()` writes metadata to the class, but it does not register the class in the DI container.** Registration happens when a module's `register()` method calls `container.register()`. But processors are not part of any module -- they are standalone classes discovered by the queue adapter through `@Job` decorator metadata.

The queue adapter found the classes (via a `jobRegistry` Map populated by `@Job`), but it instantiated them directly instead of resolving them from the container. So DI never kicked in.

## The Journey to Auto-Registration

My first fix was manual. I created what I called a `ProcessorRegistrarAdapter` -- a custom adapter that ran before the queue adapter and pre-registered every processor class in the container:

```typescript
// Early workaround (no longer needed)
export class ProcessorRegistrarAdapter implements Adapter {
  async setup(container: Container) {
    container.register(EmailProcessor, EmailProcessor);
    container.register(NotificationProcessor, NotificationProcessor);
    container.register(ActivityProcessor, ActivityProcessor);
  }
}
```

This worked but was terrible DX. Every time I added a processor, I had to remember to add a registration line. Forget it once and you get silent failures that are incredibly hard to debug.

My second attempt was an `@AutoRegister` decorator that hooked into the container at decoration time. This was clever but fragile -- the container might not exist yet when decorators run, depending on import order.

I filed an issue on the KickJS repo. The framework maintainer agreed this was a bug: if the adapter discovers classes via `@Job` metadata, it should also register them in the container before resolving. In v1.2.6, the `QueueAdapter` was updated to automatically call `container.register()` for every class in the `jobRegistry` before instantiating workers.

The fix meant our module became trivially simple:

```typescript
// src/modules/queue/queue.module.ts
import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
// Side-effect imports ensure @Job() decorators populate the jobRegistry
import './infrastructure/processors/email.processor';
import './infrastructure/processors/notification.processor';
import './infrastructure/processors/activity.processor';

export class QueueModule implements AppModule {
  register(_container: Container): void {
    // No manual registration needed — QueueAdapter v1.2.6+ auto-registers
    // @Job classes in the container before resolving them.
  }

  routes(): ModuleRoutes | null {
    return null;
  }
}
```

The side-effect imports are still necessary. They ensure the `@Job('email')` decorator executes at load time and populates the internal job registry. Without them, the adapter would not know the processor exists. But the DI registration? That is fully automatic now.

## Why This Matters Beyond KickJS

The pattern here -- decorator metadata vs. container registration -- is not unique to KickJS. If you use NestJS, Inversify, TSyringe, or any other TypeScript DI container, you will eventually run into a version of this problem.

Decorators write metadata. Containers resolve dependencies. These are two separate systems that need to stay in sync. When you add a new decorator-based pattern (like job processors, event handlers, or middleware), you need to ask: **who is responsible for registering these classes in the container?**

The options are:

1. **Manual registration.** Developer adds a line to a module or config file. Simple, but error-prone.
2. **Auto-scanning.** The framework scans the file system for decorated classes. Powerful, but slow and can cause surprising import side effects.
3. **Adapter-level registration.** The adapter that discovers classes via metadata also registers them. This is what KickJS v1.2.6 does, and I think it is the right default.

## Adding More Processors

With auto-registration working, adding new processors is straightforward. Here is the notification processor, which writes to MongoDB instead of sending email:

```typescript
// src/modules/queue/infrastructure/processors/notification.processor.ts
import { Service, Autowired, Logger } from '@forinda/kickjs-core';
import { Job, Process } from '@forinda/kickjs-queue';
import type { Job as BullMQJob } from 'bullmq';
import { MongoNotificationRepository }
  from '@/modules/notifications/infrastructure/repositories/mongo-notification.repository';

const logger = Logger.for('NotificationProcessor');

@Service()
@Job('notifications')
export class NotificationProcessor {
  @Autowired() private notificationRepo!: MongoNotificationRepository;

  @Process('create-notification')
  async createNotification(job: BullMQJob<{
    recipientId: string;
    type: string;
    title: string;
    body: string;
    metadata: Record<string, any>;
  }>) {
    logger.info(
      `Creating notification for ${job.data.recipientId}: ${job.data.type}`
    );
    await this.notificationRepo.create({
      recipientId: job.data.recipientId as any,
      type: job.data.type as any,
      title: job.data.title,
      body: job.data.body,
      metadata: job.data.metadata,
    });
  }
}
```

Notice that `@Autowired()` here has no token argument. That is because `MongoNotificationRepository` is a concrete class, not an interface behind a Symbol token. KickJS resolves it by class type. For framework-provided services like `MAILER` or `QUEUE_MANAGER`, you need the Symbol token because they are registered under those symbols by their respective adapters.

And the activity processor, which logs audit trail entries:

```typescript
// src/modules/queue/infrastructure/processors/activity.processor.ts
@Service()
@Job('activity')
export class ActivityProcessor {
  @Autowired() private activityRepo!: MongoActivityRepository;

  @Process('log-activity')
  async logActivity(job: BullMQJob<{
    workspaceId: string;
    projectId?: string;
    taskId?: string;
    actorId: string;
    action: string;
    changes?: { field: string; from?: any; to?: any };
  }>) {
    logger.info(`Logging activity: ${job.data.action} by ${job.data.actorId}`);
    await this.activityRepo.create({
      workspaceId: job.data.workspaceId as any,
      projectId: job.data.projectId as any,
      taskId: job.data.taskId as any,
      actorId: job.data.actorId as any,
      action: job.data.action as any,
      changes: job.data.changes,
    });
  }
}
```

Three processors, three queues, nine job handlers total. All discoverable via decorators, all with proper DI, and zero manual registration boilerplate.

## Lessons Learned

1. **Silent failures are the worst kind.** BullMQ swallowed the `undefined` errors because the default behavior is to retry failed jobs. Add explicit error logging in your processors, and set `removeOnFail` or `attempts` limits so bad jobs do not retry forever.

2. **Side-effect imports are a code smell, but sometimes necessary.** I would prefer auto-scanning, but explicit imports at least make the dependency graph visible.

3. **Test your DI wiring, not just your business logic.** My unit tests mocked the mailer, so they passed. Integration tests that resolved the processor from the actual container would have caught this immediately.

4. **File framework issues.** The auto-registration fix took the maintainer a few hours. My workarounds took me days. Open source works when you report problems.

The full Vibed codebase uses this pattern for all background work: emails, notifications, activity logging, and eventually file processing and report generation. Once the DI plumbing is right, adding new job types is a five-minute task. Getting the plumbing right, though -- that was the hard part.
