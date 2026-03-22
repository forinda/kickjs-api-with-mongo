---
title: "Mongoose HMR Safety in KickJS: The One-Liner That Prevents OverwriteModelError"
published: false
description: "How to prevent Mongoose OverwriteModelError during Vite HMR, why it happens, the one-line fix for every schema file, and other HMR gotchas in a Node.js backend with DI, queues, and adapter configs."
tags: kickjs, mongoose, nodejs, typescript, vite
canonical_url:
cover_image:
---

# Mongoose HMR Safety: The One-Liner That Prevents OverwriteModelError

If you have ever used Mongoose with Vite's dev server (or any HMR-capable bundler), you have seen this error:

```
OverwriteModelError: Cannot overwrite `User` model once compiled.
```

It crashes your dev server. It requires a full restart. It happens every time you save a file that is anywhere in the import chain of a schema file. And it is completely preventable with a single line of code.

I am going to explain why this happens, show the fix, and then cover the other HMR landmines I stepped on while building Vibed -- a task management backend running on KickJS (which uses Vite under the hood for development).

## Why It Happens

Mongoose maintains a global registry of models. When you call `mongoose.model('User', userSchema)`, it compiles the schema and stores the resulting model in `mongoose.models.User`. Call it again with the same name, and Mongoose throws `OverwriteModelError`.

In a traditional Node.js setup with `ts-node` or plain `node`, each file is evaluated exactly once. The model registers, and you are done.

Vite's HMR works differently. When you save a file, Vite re-evaluates the changed module and all modules that import it. If your controller imports a service that imports a repository that imports a schema, saving the controller causes the schema module to be re-evaluated. The `mongoose.model()` call runs again. The model is already registered. Boom.

Here is the timeline:

1. Server starts. `mongoose.model('User', userSchema)` runs. Model registered.
2. You edit `users.controller.ts` and save.
3. Vite's HMR re-evaluates the module graph. `user.schema.ts` gets re-evaluated.
4. `mongoose.model('User', userSchema)` runs again.
5. `OverwriteModelError`.

The error is Mongoose protecting you from accidentally registering two different schemas under the same name. But during HMR, it is the same schema -- just re-evaluated.

## The Fix: Check Before Registering

The fix is a conditional that checks if the model already exists before registering it:

```typescript
export const UserModel =
  (mongoose.models.User as mongoose.Model<UserDocument>) ||
  mongoose.model<UserDocument>('User', userSchema);
```

That is it. If `mongoose.models.User` exists (because this module was already evaluated), use the existing model. If it does not exist (first evaluation), register it. The `as mongoose.Model<UserDocument>` cast is necessary because `mongoose.models` is typed as `{ [name: string]: Model<any> }` and we want the specific document type.

## The Pattern in Practice

Here is a complete schema file from Vibed, the `User` model:

```typescript
// src/modules/users/infrastructure/schemas/user.schema.ts
import mongoose, { Schema, type Document } from 'mongoose';
import type { UserEntity } from '../../domain/entities/user.entity';

export interface UserDocument extends Omit<UserEntity, '_id'>, Document {}

const userSchema = new Schema<UserDocument>(
  {
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    avatarUrl: { type: String },
    globalRole: { type: String, enum: ['superadmin', 'user'], default: 'user' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.index({ firstName: 'text', lastName: 'text', email: 'text' });

export const UserModel =
  (mongoose.models.User as mongoose.Model<UserDocument>) ||
  mongoose.model<UserDocument>('User', userSchema);
```

The critical line is the last export. Everything else is standard Mongoose. This pattern is identical across every schema file in the project. Here are a few more:

### Task Model

```typescript
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
    attachmentCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

taskSchema.index({ projectId: 1, status: 1 });
taskSchema.index({ assigneeIds: 1 });
taskSchema.index({ dueDate: 1 });
taskSchema.index({ title: 'text', description: 'text' });

export const TaskModel =
  (mongoose.models.Task as mongoose.Model<TaskDocument>) ||
  mongoose.model<TaskDocument>('Task', taskSchema);
```

### Workspace Member Model

```typescript
const workspaceMemberSchema = new Schema<WorkspaceMemberDocument>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

workspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

export const WorkspaceMemberModel =
  (mongoose.models.WorkspaceMember as mongoose.Model<WorkspaceMemberDocument>) ||
  mongoose.model<WorkspaceMemberDocument>('WorkspaceMember', workspaceMemberSchema);
```

### Notification Model

```typescript
const notificationSchema = new Schema<NotificationDocument>(
  {
    recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['task_assigned', 'mentioned', 'comment_added',
             'task_status_changed', 'due_date_reminder', 'workspace_invite'],
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true },
);

notificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });

export const NotificationModel =
  (mongoose.models.Notification as mongoose.Model<NotificationDocument>) ||
  mongoose.model<NotificationDocument>('Notification', notificationSchema);
```

Every single schema file follows the same pattern. No exceptions. I enforce this through code review -- if a PR introduces a new schema without the `mongoose.models` check, it gets sent back.

## Why Not Use mongoose.modelNames()?

You might see alternative approaches online:

```typescript
// Alternative #1: try/catch
let UserModel: mongoose.Model<UserDocument>;
try {
  UserModel = mongoose.model<UserDocument>('User');
} catch {
  UserModel = mongoose.model<UserDocument>('User', userSchema);
}

// Alternative #2: modelNames() check
export const UserModel = mongoose.modelNames().includes('User')
  ? mongoose.model<UserDocument>('User')
  : mongoose.model<UserDocument>('User', userSchema);
```

Both work, but the `mongoose.models.X || mongoose.model()` pattern is more concise. It is a single expression, easy to grep for in code review, and the intent is immediately clear. The try/catch approach obscures what is happening, and the `modelNames()` approach is unnecessarily verbose.

## Other HMR Gotchas in a Backend Context

Mongoose models are the most common HMR issue, but they are not the only one. Here is what else I learned the hard way.

### Adapter Configurations Need Full Restarts

KickJS adapter configurations (database connections, auth strategies, queue adapters, cron jobs) are evaluated once at startup and cached internally by the framework:

```typescript
// src/config/adapters.ts
export const adapters = [
  new MongooseAdapter(env.MONGODB_URI),
  new RedisAdapter(env.REDIS_URL),
  new AuthAdapter({
    strategies: [
      new JwtStrategy({
        secret: env.JWT_SECRET,
        mapPayload: (payload: any) => ({
          id: payload.sub,
          email: payload.email,
          globalRole: payload.globalRole ?? 'user',
        }),
      }),
    ],
    defaultPolicy: 'protected',
  }),
  new QueueAdapter({
    redis: { host: redisUrl.hostname, port: Number(redisUrl.port) || 6379 },
    queues: ['email', 'notifications', 'activity'],
    concurrency: 5,
  }),
  new CronAdapter({
    services: [TaskCronJobs, DigestCronJobs, CleanupCronJobs, PresenceCronJobs, HealthCheckCronJobs],
    enabled: true,
  }),
  // ... more adapters
];
```

Changing anything here -- adding a new queue name, changing auth policy, updating Redis config -- requires a full server restart. Vite's HMR will re-evaluate the file, but the framework has already initialized with the original adapter instances. The new configuration is silently ignored.

I wasted a debugging session wondering why a new queue was not processing jobs. The queue was defined in the re-evaluated config, but `QueueAdapter` had already initialized with the original queue list. A full restart fixed it.

### Queue Processor Classes Need Full Restarts

Queue processors are resolved from the DI container at initialization time. If you change the implementation of a `@Job()` processor class, HMR re-evaluates the class definition, but the queue worker is still running the old instance:

```typescript
// This file is imported as a side-effect in the queue module
import './infrastructure/processors/email.processor';
import './infrastructure/processors/notification.processor';
import './infrastructure/processors/activity.processor';
```

Modifying `email.processor.ts` and saving will not update the running processor. You need a full restart. This is a known limitation of any system where long-lived worker instances are created at boot time.

### DI Container Bindings Are Sticky

When a module registers a repository binding in its `register()` method, that binding persists across HMR reloads. If you change the binding (say, swapping `MongoUserRepository` for a `PostgresUserRepository`), the container still has the original binding. Full restart required.

However, the classes themselves (controllers, services, use cases) do get updated by HMR, because they are resolved fresh from the container on each request. This means:

- **HMR works for**: Controller logic, use case business logic, DTO validation schemas, query helpers, utility functions
- **HMR does NOT work for**: Adapter configs, DI bindings, queue processors, cron job schedules, model schemas (without the guard pattern)

### New Modules Need Full Restarts

Adding a new module to the modules array requires re-evaluating the module registry, which the framework reads once at boot:

```typescript
// src/modules/index.ts
export const modules = [
  new AuthModule(),
  new UsersModule(),
  new WorkspacesModule(),
  new ProjectsModule(),
  // Adding a new module here requires restart
];
```

HMR will re-evaluate this file, but the framework's router has already been built from the original module list. The new module's routes will not be registered until you restart.

## Enforcing the Pattern

For the Mongoose guard specifically, I have a simple rule: every schema file in `infrastructure/schemas/` must export its model using the `mongoose.models.X || mongoose.model()` pattern. Here is what I look for in code review:

```
// GOOD
export const FooModel =
  (mongoose.models.Foo as mongoose.Model<FooDocument>) ||
  mongoose.model<FooDocument>('Foo', fooSchema);

// BAD - will crash on HMR
export const FooModel = mongoose.model<FooDocument>('Foo', fooSchema);
```

The pattern is greppable. You can write a lint rule for it. You can check for it in CI. There is no reason for any schema file to not use it.

## A Note on Next.js and Other Frameworks

This same pattern is widely used in Next.js projects with Mongoose, for the same reason. Next.js's dev server uses HMR and re-evaluates modules on changes. The Mongoose community has converged on this guard pattern regardless of framework. If you search for "Next.js Mongoose OverwriteModelError," you will find the same solution.

The difference with a backend framework like KickJS is that you have more categories of state that survive HMR (adapters, queues, cron, DI container). In a Next.js API route, you mostly just have Mongoose models. In a full backend, you have to know which things HMR updates and which things it does not.

## Quick Reference: What Needs a Restart?

| Change | HMR Picks Up? | Needs Restart? |
|--------|---------------|----------------|
| Controller handler logic | Yes | No |
| Use case / service logic | Yes | No |
| DTO / Zod schema | Yes | No |
| Query helper functions | Yes | No |
| Mongoose schema fields | No* | Yes |
| Adapter configuration | No | Yes |
| New module added to array | No | Yes |
| Queue processor logic | No | Yes |
| Cron job schedule | No | Yes |
| DI container bindings | No | Yes |

*Mongoose schema changes are tricky. The model guard prevents the crash, but the existing model instance keeps the old schema. If you add a new field to a schema, you need a restart for Mongoose to recognize it.

## Takeaway

The `OverwriteModelError` fix is genuinely a one-liner. Write it once per schema file, and HMR works smoothly for the vast majority of your development workflow. The real lesson is broader: understand what your HMR system re-evaluates and what it does not. Mongoose models are the most visible symptom, but adapters, queues, cron jobs, and DI bindings all have the same underlying issue -- they are initialized once at boot time, and re-evaluating their source code does not re-initialize them.

For day-to-day development, the split is actually favorable. You spend most of your time writing controller logic, business rules in use cases, and validation schemas -- all of which HMR handles correctly. Schema changes, adapter config, and new modules are less frequent and worth the occasional restart.

The one-liner that matters:

```typescript
export const YourModel =
  (mongoose.models.YourModel as mongoose.Model<YourDocument>) ||
  mongoose.model<YourDocument>('YourModel', yourSchema);
```

Put it in every schema file. Never think about `OverwriteModelError` again.
