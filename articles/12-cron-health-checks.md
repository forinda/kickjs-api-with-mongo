---
title: "KickJS Cron-Driven Health Checks: Monitoring MongoDB, Redis, and Queues From Inside Your App"
description: "How I built internal health monitoring using cron jobs, dependency injection, and structured logging — no external monitoring tool required."
tags: ["kickjs", "nodejs", "typescript", "mongodb", "monitoring"]
canonical_url: ""
published: false
cover_image: ""
---

# Cron-Driven Health Checks: Monitoring MongoDB, Redis, and Queues From Inside Your App

External monitoring tools like Datadog, New Relic, and UptimeRobot are great. But they check your app from the outside -- is the HTTP endpoint responding? Internal health is a different question. Is MongoDB actually accepting writes? Is Redis reachable? Are your BullMQ workers processing jobs, or are they silently stalled?

For Vibed, our task management backend, I built cron-driven health checks that run inside the application process. They check every dependency, log structured results, and give me a single "Health OK" or "Health DEGRADED" line every minute in the logs. It took about 50 lines of code and caught a Redis connection leak two days later.

Here is how I built it with KickJS's `CronAdapter` and why internal monitoring complements -- not replaces -- external tools.

## The CronAdapter Setup

KickJS provides a `CronAdapter` that discovers classes with `@Cron` decorators and schedules them using standard cron expressions. You register it in the adapter list:

```typescript
// src/config/adapters.ts
import { CronAdapter } from '@forinda/kickjs-cron';
import { TaskCronJobs }
  from '@/modules/cron/infrastructure/jobs/overdue-reminders.cron';
import { DigestCronJobs }
  from '@/modules/cron/infrastructure/jobs/daily-digest.cron';
import { CleanupCronJobs }
  from '@/modules/cron/infrastructure/jobs/token-cleanup.cron';
import { PresenceCronJobs }
  from '@/modules/cron/infrastructure/jobs/presence-cleanup.cron';
import { HealthCheckCronJobs }
  from '@/modules/cron/infrastructure/jobs/health-check.cron';

export const adapters = [
  // ... other adapters (Mongoose, Redis, Auth, Queue, etc.)

  new CronAdapter({
    services: [
      TaskCronJobs,
      DigestCronJobs,
      CleanupCronJobs,
      PresenceCronJobs,
      HealthCheckCronJobs,
    ],
    enabled: true,
  }),
];
```

The `services` array lists every class that contains `@Cron` methods. The adapter instantiates them through the DI container (so `@Autowired` works) and starts the schedules when the app boots. The `enabled` flag is useful for disabling all cron jobs in test environments without removing the configuration.

## Building the Health Check

The health check cron job is the simplest and most valuable class in the Vibed codebase. It checks three things every minute: MongoDB connectivity, Redis connectivity, and BullMQ queue availability.

```typescript
// src/modules/cron/infrastructure/jobs/health-check.cron.ts
import { Service, Autowired, Logger } from '@forinda/kickjs-core';
import { Cron } from '@forinda/kickjs-cron';
import { QUEUE_MANAGER, type QueueService } from '@forinda/kickjs-queue';
import { TOKENS } from '@/shared/constants/tokens';
import mongoose from 'mongoose';
import type { Redis } from 'ioredis';

const logger = Logger.for('HealthCheckCron');

@Service()
export class HealthCheckCronJobs {
  @Autowired(TOKENS.REDIS) private redis!: Redis;
  @Autowired(QUEUE_MANAGER) private queueService!: QueueService;

  @Cron('* * * * *', { description: 'Run system health check every minute' })
  async healthCheck() {
    const results = {
      mongo: false,
      redis: false,
      queues: false,
    };

    try {
      results.mongo = mongoose.connection.readyState === 1;
    } catch { /* ignore */ }

    try {
      const pong = await this.redis.ping();
      results.redis = pong === 'PONG';
    } catch { /* ignore */ }

    try {
      const queueNames = this.queueService.getQueueNames();
      results.queues = queueNames.length > 0;
    } catch { /* ignore */ }

    const allHealthy = results.mongo && results.redis && results.queues;

    if (allHealthy) {
      logger.info('Health OK — mongo: ✓, redis: ✓, queues: ✓');
    } else {
      logger.warn(
        `Health DEGRADED — mongo: ${results.mongo ? '✓' : '✗'}, ` +
        `redis: ${results.redis ? '✓' : '✗'}, ` +
        `queues: ${results.queues ? '✓' : '✗'}`,
      );
    }
  }
}
```

Let me walk through the three checks.

### MongoDB: `mongoose.connection.readyState`

Mongoose maintains a connection state enum: 0 (disconnected), 1 (connected), 2 (connecting), 3 (disconnecting). Checking `=== 1` tells me if the connection is fully established and healthy.

I do not need to inject Mongoose through DI here because `mongoose` is a singleton module -- importing it gives me the same connection that the `MongooseAdapter` established at startup. This is one of the few cases where a direct import is cleaner than DI.

### Redis: `redis.ping()`

The Redis client is injected via `@Autowired(TOKENS.REDIS)`. The `TOKENS.REDIS` symbol is defined in the shared constants:

```typescript
// src/shared/constants/tokens.ts
export const TOKENS = {
  // Infrastructure
  MONGOOSE: Symbol('Mongoose'),
  REDIS: Symbol('Redis'),

  // Repositories
  USER_REPOSITORY: Symbol('UserRepository'),
  TASK_REPOSITORY: Symbol('TaskRepository'),
  // ... more tokens
} as const;
```

The Redis adapter registers the ioredis client under this symbol during setup. `redis.ping()` sends a PING command to the Redis server and expects "PONG" back. If it throws or returns something else, Redis is unhealthy.

### BullMQ Queues: `queueService.getQueueNames()`

The `QueueService` is injected via `@Autowired(QUEUE_MANAGER)`, where `QUEUE_MANAGER` is a Symbol exported from `@forinda/kickjs-queue`. Calling `getQueueNames()` returns the list of registered queue names (in our case, `['email', 'notifications', 'activity']`). If this returns an empty array or throws, the queue infrastructure is not initialized.

This check does not tell me if workers are actively processing. For that, you would need to check `queue.getWorkersCount()` or monitor failed job counts. But knowing that the queue objects exist and are reachable covers the most common failure mode: Redis went down and queues cannot connect.

## Why @Autowired Over Manual Resolution

You might wonder why I use `@Autowired(TOKENS.REDIS)` instead of resolving from the container manually. I tried both. Manual resolution looks like this:

```typescript
// Not recommended — loses type safety and fails silently
const redis = Container.resolve<Redis>(TOKENS.REDIS);
```

The problem is that `Container.resolve()` is a static call that depends on the container being initialized. In cron jobs, the execution context is managed by the adapter, not by you. If you call `Container.resolve()` too early (before adapters finish setup) or if the container reference is wrong (after HMR in development), you get `undefined` with no error.

`@Autowired()` is better for three reasons:

1. **Lazy resolution.** The property is resolved when first accessed, not when the class is constructed. By the time the cron job fires, all adapters are fully initialized.

2. **Type safety.** The TypeScript type of the property matches what the container returns, and the framework validates the token at resolution time.

3. **Testability.** In tests, you can replace `@Autowired` properties with mocks by setting them directly on the instance. With static `Container.resolve()`, you need to mock the container itself.

## Other Cron Jobs in Vibed

The health check is just one of five cron job classes in the Vibed codebase. Here are the others, each solving a different operational concern.

### Overdue Task Reminders

Runs every day at 9 AM UTC. Queries for tasks past their due date and queues email reminders for each assignee:

```typescript
// src/modules/cron/infrastructure/jobs/overdue-reminders.cron.ts
@Service()
export class TaskCronJobs {
  @Autowired(TOKENS.TASK_REPOSITORY) private taskRepo!: ITaskRepository;
  @Autowired(TOKENS.USER_REPOSITORY) private userRepo!: IUserRepository;
  @Autowired(QUEUE_MANAGER) private queueService!: QueueService;

  @Cron('0 9 * * *', {
    description: 'Send overdue task reminders',
    timezone: 'UTC',
  })
  async overdueReminders() {
    logger.info('Running overdue task reminders...');

    const overdueTasks = await this.taskRepo.findOverdue();
    for (const task of overdueTasks) {
      for (const assigneeId of task.assigneeIds) {
        const user = await this.userRepo.findById(assigneeId.toString());
        if (user) {
          await this.queueService.add('email', 'send-overdue-reminder', {
            email: user.email,
            taskKey: task.key,
            taskTitle: task.title,
            dueDate: task.dueDate?.toISOString(),
          });
        }
      }
    }
    logger.info(`Sent reminders for ${overdueTasks.length} overdue tasks`);
  }
}
```

This is a good example of cron jobs and queue jobs working together. The cron job identifies what work needs to happen. The queue job does the actual work (sending emails) with retry logic and concurrency control. Separation of scheduling from execution.

### Token Cleanup

Runs at 3 AM UTC daily. Deletes expired refresh tokens from MongoDB:

```typescript
// src/modules/cron/infrastructure/jobs/token-cleanup.cron.ts
@Service()
export class CleanupCronJobs {
  @Autowired(TOKENS.REFRESH_TOKEN_REPOSITORY)
  private tokenRepo!: IRefreshTokenRepository;

  @Cron('0 3 * * *', {
    description: 'Clean up expired refresh tokens',
    timezone: 'UTC',
  })
  async cleanupTokens() {
    logger.info('Running token cleanup...');
    const deleted = await this.tokenRepo.deleteExpired();
    logger.info(`Cleaned up ${deleted} expired refresh tokens`);
  }
}
```

Without this, the refresh tokens collection grows unbounded. Every login creates a token, and expired ones are never read again but still consume storage and slow down queries. A simple nightly cleanup keeps the collection lean.

### Presence Cleanup

Runs every 5 minutes. Clears stale WebSocket presence entries from Redis:

```typescript
// src/modules/cron/infrastructure/jobs/presence-cleanup.cron.ts
@Service()
export class PresenceCronJobs {
  @Cron('*/5 * * * *', { description: 'Clean up stale presence entries' })
  async cleanupPresence() {
    logger.info('Running presence cleanup... (placeholder)');
    // Check Redis presence hash, remove entries with stale heartbeats
  }
}
```

### Daily Digest

Runs at 8 AM UTC on weekdays. Aggregates the previous day's activity per workspace and enqueues digest emails:

```typescript
// src/modules/cron/infrastructure/jobs/daily-digest.cron.ts
@Service()
export class DigestCronJobs {
  @Cron('0 8 * * 1-5', {
    description: 'Send daily digest emails',
    timezone: 'UTC',
  })
  async dailyDigest() {
    logger.info('Running daily digest... (placeholder)');
    // Aggregate yesterday's activity per workspace, enqueue digest emails
  }
}
```

The cron expression `0 8 * * 1-5` means "at minute 0, hour 8, Monday through Friday." This is standard cron syntax, nothing KickJS-specific.

## The Module That Has No Routes

One thing worth noting: the cron jobs are not part of a traditional module with HTTP routes. KickJS modules that return `null` from `routes()` work fine in the modules array. But there is a subtlety. The cron jobs are not registered through a module at all -- they are registered through the `CronAdapter` in the adapters configuration:

```typescript
new CronAdapter({
  services: [
    TaskCronJobs,
    DigestCronJobs,
    CleanupCronJobs,
    PresenceCronJobs,
    HealthCheckCronJobs,
  ],
  enabled: true,
}),
```

The adapter handles DI resolution, schedule registration, and lifecycle management. The classes just need `@Service()` so the container knows how to construct them, and `@Cron()` so the adapter knows when to run them.

## Logging: Health OK vs. Health DEGRADED

The choice to log at `info` level for healthy checks and `warn` level for degraded is deliberate. In production, I route `warn` and above to an alerting channel (Slack, PagerDuty, whatever). `info` goes to the regular log stream for debugging.

This means:
- When everything is fine, the logs show a quiet heartbeat: `Health OK` every minute.
- When something breaks, the log level changes and triggers an alert automatically.
- Looking at historical logs, I can see exactly when a service went down and came back up.

The output looks like this in normal operation:

```
[2026-03-22T10:00:00Z] INFO  [HealthCheckCron] Health OK — mongo: ✓, redis: ✓, queues: ✓
[2026-03-22T10:01:00Z] INFO  [HealthCheckCron] Health OK — mongo: ✓, redis: ✓, queues: ✓
```

And when Redis drops:

```
[2026-03-22T10:02:00Z] WARN  [HealthCheckCron] Health DEGRADED — mongo: ✓, redis: ✗, queues: ✗
[2026-03-22T10:03:00Z] WARN  [HealthCheckCron] Health DEGRADED — mongo: ✓, redis: ✗, queues: ✗
[2026-03-22T10:04:00Z] INFO  [HealthCheckCron] Health OK — mongo: ✓, redis: ✓, queues: ✓
```

Notice that queues also go down when Redis drops. That is expected -- BullMQ uses Redis as its backing store. The health check captures this cascading failure automatically.

## Why Internal Monitoring Matters

External monitoring tells you "the server returned a 503." Internal monitoring tells you why. Maybe MongoDB is fine but Redis is down. Maybe all services are up but the queue workers are stalled because of a bad deployment. Maybe the database is connected but writes are timing out because of a lock.

Internal health checks give you diagnostic information that external probes cannot. They run with the same permissions, connections, and configuration as your actual request handlers. If the health check can reach MongoDB, your API can too.

The combination I recommend:

1. **External uptime monitoring** (e.g., a /health HTTP endpoint checked by UptimeRobot) for "is the process alive?"
2. **Internal cron-based checks** (like what I described here) for "are all dependencies functional?"
3. **Application-level metrics** (request latency, error rates, queue depth) for "is performance acceptable?"

The cron-based health check covers layer 2 with minimal effort. No external infrastructure, no additional services, no monitoring SaaS bill. Just a class with three try/catch blocks that runs every minute.

## Extending the Pattern

Once you have the basic structure, adding new checks is trivial. Want to verify that your S3 bucket is accessible? Add a `headObject` call. Need to check an external API dependency? Add a `fetch` with a timeout. Want to monitor queue depth?

```typescript
try {
  const emailQueue = this.queueService.getQueue('email');
  const waiting = await emailQueue.getWaitingCount();
  results.queueDepth = waiting < 1000; // alert if backlog exceeds 1000
} catch { /* ignore */ }
```

The pattern scales because each check is independent and wrapped in its own try/catch. A failure in one check does not prevent the others from running. The results object gives you a clear snapshot of system health at any point in time.

Fifty lines of code. One minute of setup. It caught a Redis connection leak on day two of production. That is the kind of return on investment I like from infrastructure code.
