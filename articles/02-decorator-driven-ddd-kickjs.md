---
title: "Building a Jira-like Backend with Decorator-Driven DDD in KickJS"
description: "How I structured a task management backend using KickJS, TypeScript decorators, and Domain-Driven Design — with real code from the Vibed project."
tags: ["kickjs", "nodejs", "typescript", "mongodb", "ddd"]
canonical_url: null
published: false
---

# Building a Jira-like Backend with Decorator-Driven DDD in Node.js

I recently built Vibed, a Jira-like task management backend, and I want to share the architectural decisions that kept the codebase manageable as it grew to 14 modules with tasks, workspaces, projects, real-time messaging, queues, and cron jobs. The key ingredient was decorator-driven Domain-Driven Design using a framework called KickJS.

## Why Not NestJS or Raw Express?

This is the first question everyone asks, so let me address it head-on.

**Raw Express** gives you total freedom, which sounds great until your fifth module. By then you have five different ways to validate input, three patterns for error handling, and a growing sense of dread every time you need to add a new endpoint. I have been down that road. The "freedom" becomes a tax on every new feature.

**NestJS** solves the structure problem, but it comes with a learning curve that feels disproportionate for mid-sized projects. Its module system, with providers, imports, exports, and forwardRef for circular dependencies, adds ceremony that I did not need. NestJS is excellent for large teams where the rigidity pays off. For a solo developer or small team moving fast, it felt heavy.

**KickJS** sits in a sweet spot. It gives you TypeScript decorators for controllers, services, and repositories. It gives you a DI container. It gives you Express 5 under the hood so the ecosystem is familiar. But it does not force you into a module graph with imports and exports. You register your bindings, you declare your routes, and you move on.

Here is the entire entry point of Vibed:

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

Five lines of configuration. The complexity lives in the modules, not in the bootstrap.

## The DDD Module Structure

Every module in Vibed follows a strict directory layout. This is not enforced by the framework -- KickJS does not care how you organize files. But having a convention means I never wonder where something goes.

```
src/modules/tasks/
  tasks.module.ts              # DI registration + route mounting
  presentation/
    tasks.controller.ts        # HTTP layer — decorators, request/response
  application/
    dtos/
      create-task.dto.ts       # Zod validation schemas
      update-task.dto.ts
      change-status.dto.ts
    use-cases/
      create-task.use-case.ts  # Business logic
      update-task.use-case.ts
      change-status.use-case.ts
  domain/
    entities/
      task.entity.ts           # TypeScript interfaces
    repositories/
      task.repository.ts       # Repository interface (contract)
  infrastructure/
    schemas/
      task.schema.ts           # Mongoose schema + model
    repositories/
      mongo-task.repository.ts # MongoDB implementation of the interface
```

The layers flow inward. Presentation depends on Application. Application depends on Domain. Infrastructure implements Domain interfaces. Domain depends on nothing.

This matters because when I eventually need to swap MongoDB for PostgreSQL, I change `infrastructure/` and nothing else. The use cases do not know or care what database is behind the `ITaskRepository` interface.

## Decorators: The Building Blocks

### @Controller and Route Decorators

Controllers handle HTTP concerns and nothing else. They parse requests, call use cases, and format responses.

```typescript
// src/modules/tasks/presentation/tasks.controller.ts
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
    const result = await this.createTaskUseCase.execute(
      ctx.params.projectId,
      user.id,
      ctx.body,
    );
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
        parsed.filters.push({
          field: 'projectId',
          operator: 'eq',
          value: ctx.params.projectId,
        });
        return this.taskRepo.findPaginated(parsed);
      },
      TASK_QUERY_CONFIG,
    );
  }
}
```

A few things to notice. The `@Controller()` decorator has no path argument. That is intentional -- the module sets the mount path, and putting a path on both would double the prefix (a lesson I learned the hard way, producing `/api/v1/tasks/tasks/...`).

The `@Middleware(authBridgeMiddleware)` at class level means every route in this controller requires authentication. Individual routes can add more middleware, like `projectAccessGuard`, which verifies the user has access to the specific project.

Validation is inline with Zod schemas passed directly to the route decorator. By the time `ctx.body` reaches the handler, it is already validated and typed. No manual parsing.

### @Service and @Inject for Use Cases

Use cases contain business logic. They receive dependencies through constructor injection.

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
      ? Math.max(...maxOrderTask
          .filter(t => t.status === dto.status)
          .map(t => t.orderIndex))
      : -1;

    return this.taskRepo.create({
      ...dto,
      projectId: projectId as any,
      workspaceId: project.workspaceId,
      key,
      reporterId: userId as any,
      assigneeIds: dto.assigneeIds as any[],
      labelIds: dto.labelIds as any[],
      parentTaskId: dto.parentTaskId as any,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      orderIndex: maxOrder + 1,
    });
  }
}
```

The `@Inject(TOKENS.TASK_REPOSITORY)` decorator tells the DI container to resolve the `ITaskRepository` interface using whatever concrete implementation was registered under that token. The use case never imports `MongoTaskRepository` directly.

One critical gotcha: `@Inject(TOKEN)` only works on constructor parameters. If you try to use it on a class property, it silently does nothing. For property injection, you use `@Autowired()`, which resolves by class type instead of token.

### @Repository for Infrastructure

The repository implementation is straightforward Mongoose code behind an interface:

```typescript
// src/modules/tasks/infrastructure/repositories/mongo-task.repository.ts
@Repository()
export class MongoTaskRepository implements ITaskRepository {
  async findById(id: string): Promise<TaskEntity | null> {
    return TaskModel.findById(id).lean() as any;
  }

  async create(data: Partial<TaskEntity>): Promise<TaskEntity> {
    const doc = await TaskModel.create(data);
    return doc.toObject() as any;
  }

  async findPaginated(parsed: any): Promise<{ data: TaskEntity[]; total: number }> {
    const { filters = [], sort = [], pagination = { page: 1, limit: 20, offset: 0 }, search = '' } = parsed;
    const mongoFilter = {
      ...buildMongoFilter(filters),
      ...buildMongoSearch(search),
    };
    const mongoSort = buildMongoSort(sort);

    const [data, total] = await Promise.all([
      TaskModel.find(mongoFilter)
        .sort(mongoSort)
        .skip(pagination.offset)
        .limit(pagination.limit)
        .lean(),
      TaskModel.countDocuments(mongoFilter),
    ]);

    return { data: data as any[], total };
  }

  // ... other methods
}
```

The `@Repository()` decorator registers the class in the DI container so it can be resolved by `@Autowired()` in controllers or by token in use cases.

## Module Registration and Route Mounting

Each module has a module file that wires everything together:

```typescript
// src/modules/tasks/tasks.module.ts
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

The `register` method binds the `TOKENS.TASK_REPOSITORY` symbol to a factory that resolves `MongoTaskRepository`. This is what makes `@Inject(TOKENS.TASK_REPOSITORY)` work in use cases.

The `routes` method mounts the controller. The tasks module uses `path: '/'` because its controller routes already include the full path like `/projects/:projectId/tasks` and `/tasks/:taskId`.

Compare that with the workspaces module, which uses a prefix:

```typescript
// src/modules/workspaces/workspaces.module.ts
export class WorkspacesModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.WORKSPACE_REPOSITORY, () =>
      container.resolve(MongoWorkspaceRepository),
    );
    container.registerFactory(TOKENS.WORKSPACE_MEMBER_REPOSITORY, () =>
      container.resolve(MongoWorkspaceMemberRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/workspaces',
      router: buildRoutes(WorkspacesController),
      controller: WorkspacesController,
    };
  }
}
```

Here `path: '/workspaces'` means controller routes like `@Post('/')` and `@Get('/:workspaceId')` become `/api/v1/workspaces/` and `/api/v1/workspaces/:workspaceId`.

All modules are collected in a single registry:

```typescript
// src/modules/index.ts
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

Adding a new domain to the application means creating the module directory, implementing the layers, and adding one line to this array.

## The Domain Layer: Interfaces That Protect You

The domain layer is pure TypeScript. No decorators, no framework imports, no database types.

```typescript
// src/modules/tasks/domain/entities/task.entity.ts
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low' | 'none';

export interface TaskEntity extends BaseEntity {
  projectId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  key: string;
  title: string;
  description?: string;
  status: string;
  priority: TaskPriority;
  assigneeIds: Types.ObjectId[];
  reporterId: Types.ObjectId;
  labelIds: Types.ObjectId[];
  parentTaskId?: Types.ObjectId;
  dueDate?: Date;
  estimatePoints?: number;
  orderIndex: number;
  attachmentCount: number;
  commentCount: number;
}
```

```typescript
// src/modules/tasks/domain/repositories/task.repository.ts
export interface ITaskRepository {
  findById(id: string): Promise<TaskEntity | null>;
  findByProject(projectId: string): Promise<TaskEntity[]>;
  findByKey(key: string): Promise<TaskEntity | null>;
  create(data: Partial<TaskEntity>): Promise<TaskEntity>;
  update(id: string, data: Partial<TaskEntity>): Promise<TaskEntity | null>;
  delete(id: string): Promise<boolean>;
  findPaginated(parsed: any): Promise<{ data: TaskEntity[]; total: number }>;
  findOverdue(): Promise<TaskEntity[]>;
  countByStatus(projectId: string): Promise<Record<string, number>>;
  findSubtasks(parentTaskId: string): Promise<TaskEntity[]>;
}
```

This is the contract. Any repository implementation -- Mongo, Postgres, in-memory for tests -- must satisfy this interface. The use cases depend on `ITaskRepository`, never on `MongoTaskRepository`.

## DI Token Management

All DI tokens live in a single file:

```typescript
// src/shared/constants/tokens.ts
export const TOKENS = {
  USER_REPOSITORY: Symbol('UserRepository'),
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
  // ...
} as const;
```

Using `Symbol` ensures no accidental collisions. Each token is unique by identity, not by string value. The `as const` assertion makes the types narrow and autocomplete-friendly.

## When Does Decorator-Driven DDD Make Sense?

After building 14 modules this way, here is my honest take.

**It works well when** you have multiple bounded contexts that share infrastructure. Vibed has tasks, workspaces, projects, channels, messages, notifications, and more. Each is its own world with its own entities and rules, but they all use MongoDB and the same auth system. DDD modules keep them isolated. Decorators keep the boilerplate low.

**It works well when** you want Swagger docs that stay in sync. The `@ApiOperation`, `@ApiResponse`, and `@ApiQueryParams` decorators generate OpenAPI specs directly from the code. No separate YAML file to maintain.

**It does not make sense** for simple CRUD APIs with two or three resources. The layer separation adds files that provide no value when the "business logic" is just "save to database." A flat Express app would be faster to build and easier to understand.

**It does not make sense** if your team is not comfortable with TypeScript decorators and DI. The learning curve is real. `@Inject` only working on constructor params, `@Autowired` resolving by class type, tokens being symbols -- these are not obvious, and getting them wrong produces silent failures, not compiler errors.

The sweet spot is a mid-sized backend with enough domain complexity to justify the layers, a team that knows TypeScript well, and a desire for convention without the full weight of NestJS. Vibed fit that description perfectly, and the structure has paid dividends as the feature set grew.
