---
title: "KickJS: Why Your Middleware Can't Talk to Your Handler — and How Shared RequestContext Fixes It"
description: "A deep dive into a subtle framework bug where ctx.set() in middleware was invisible to ctx.get() in handlers, how we worked around it, and what the proper fix looks like."
tags: ["kickjs", "nodejs", "typescript", "middleware", "express"]
canonical_url: ""
published: false
cover_image: ""
---

# Why Your Middleware Can't Talk to Your Handler — and How Shared RequestContext Fixes It

I spent three hours staring at a bug that should not have existed. My auth middleware was setting the user on the request context. My route handler was reading the user from the request context. The user was always `undefined`. The middleware was definitely running. The JWT was definitely valid. I added logs everywhere. The user was absolutely being set. And yet the handler could not see it.

This is the story of a framework abstraction that leaked, the workaround that got us through production, and the proper fix that landed in KickJS v1.2.5. If you build middleware-heavy applications with decorator-driven frameworks, you will probably encounter something like this eventually.

## The Setup

I am building Vibed, a Jira-like task management backend, using KickJS -- a decorator-driven Node.js framework built on Express 5 and TypeScript. KickJS provides a `RequestContext` object that wraps Express's `req` and `res` into a cleaner API. Instead of reaching into `req.headers` or calling `res.json()`, you work with `ctx.headers`, `ctx.json()`, and a metadata store via `ctx.set()` and `ctx.get()`.

The pattern is straightforward. Middleware authenticates the user and stores it on the context. The handler reads it back:

```typescript
// The middleware
export const authBridgeMiddleware: MiddlewareHandler = (ctx: RequestContext, next) => {
  const token = ctx.headers['authorization']?.replace('Bearer ', '');
  const payload = jwt.verify(token, env.JWT_SECRET);
  ctx.set('user', {
    id: payload.sub,
    email: payload.email,
    globalRole: payload.globalRole ?? 'user',
  });
  next();
};

// The handler
@Controller()
@Middleware(authBridgeMiddleware)
export class TasksController {
  @Get('/tasks/:taskId')
  async getOne(ctx: RequestContext) {
    const user = ctx.get('user'); // undefined. Always undefined.
    // ...
  }
}
```

This looks correct. In Express, you would write `req.user = payload` in middleware and read `req.user` in the handler. The `ctx.set()`/`ctx.get()` API is supposed to be the KickJS equivalent. But it was not working.

## The Root Cause: Separate Context Instances

After digging into the KickJS framework source, I found the problem in the router builder. When KickJS mounts routes, it creates the middleware and handler chains like this (simplified):

```typescript
// Inside KickJS router-builder.ts (pre-v1.2.5)
// For each middleware:
handlers.push((req, res, next) => {
  const ctx = new RequestContext(req, res, next); // NEW instance
  Promise.resolve(mw(ctx, next)).catch(next);
});

// For the handler:
handlers.push(async (req, res, next) => {
  const ctx = new RequestContext(req, res, next); // ANOTHER new instance
  const controller = container.resolve(controllerClass);
  await controller[route.handlerName](ctx);
});
```

Every middleware and every handler gets a *brand new* `RequestContext`. Each `RequestContext` has its own private `metadata` Map. When you call `ctx.set('user', payload)` in the middleware, you are writing to Map instance A. When the handler calls `ctx.get('user')`, it is reading from Map instance B. They share the same underlying `req` and `res`, but their metadata stores are completely isolated.

This is the kind of bug that is invisible from the outside. The API contract says `ctx.set()` and `ctx.get()` share data across the request lifecycle. The implementation says otherwise.

## The Workaround: Mutate `req` Directly

Once I understood the problem, the workaround was obvious if ugly. Since all the `RequestContext` instances share the same `req` object, I could store data directly on `req`:

```typescript
// Middleware -- store on req
export const authBridgeMiddleware: MiddlewareHandler = (ctx: RequestContext, next) => {
  const token = ctx.headers['authorization']?.replace('Bearer ', '');
  const payload = jwt.verify(token, env.JWT_SECRET);
  (ctx.req as any).user = {
    id: payload.sub,
    email: payload.email,
    globalRole: payload.globalRole ?? 'user',
  };
  next();
};

// Handler -- read from req
async getOne(ctx: RequestContext) {
  const user = (ctx.req as any).user; // Works!
}
```

This worked. But `(ctx.req as any).user` is a mess -- no type safety, no autocomplete, and it completely bypasses the context abstraction the framework provides. So I wrapped it in a helper function to contain the ugliness:

```typescript
// src/shared/utils/auth.ts
import type { RequestContext } from '@forinda/kickjs-http';
import { HttpException } from '@forinda/kickjs-core';

export interface AuthUser {
  id: string;
  email: string;
  globalRole: string;
}

export function getUser(ctx: RequestContext): AuthUser {
  const user = (ctx.req as any).user as AuthUser | undefined;
  if (!user) {
    throw HttpException.unauthorized('Authentication required');
  }
  return user;
}
```

Now every handler calls `getUser(ctx)` and gets a typed `AuthUser` back. The ugly `req` mutation is in one place. If the framework ever fixes this, I only have to change one file.

This pattern extended to our guards too. The workspace membership guard needed to pass the membership object to downstream middleware and handlers:

```typescript
export const workspaceMembershipGuard: MiddlewareHandler = async (ctx: RequestContext, next) => {
  const user = (ctx.req as any).user;
  if (!user) {
    throw HttpException.unauthorized('Authentication required');
  }

  const workspaceId = ctx.params.workspaceId;
  if (!workspaceId) return next();

  const container = Container.getInstance();
  const memberRepo = container.resolve<IWorkspaceMemberRepository>(
    TOKENS.WORKSPACE_MEMBER_REPOSITORY,
  );
  const member = await memberRepo.findByUserAndWorkspace(user.id, workspaceId);

  if (!member) {
    throw HttpException.forbidden(ErrorCode.NOT_WORKSPACE_MEMBER);
  }

  (ctx.req as any).workspaceMember = member;
  next();
};
```

We had the same pattern in our project access guard and channel membership guard. Every guard read from `req` and wrote to `req`. The context abstraction was effectively dead.

## The Fix in KickJS v1.2.5: Shared Metadata on `req`

The KickJS maintainer (disclosure: that is also me) fixed this in v1.2.5 using what I call Option B from our issue tracker -- storing the metadata Map on `req` instead of on each `RequestContext` instance:

```typescript
// Inside RequestContext (v1.2.5+)
private get metadata(): Map<string, any> {
  if (!(this.req as any).__ctxMeta) {
    (this.req as any).__ctxMeta = new Map();
  }
  return (this.req as any).__ctxMeta;
}
```

The first `RequestContext` created for a request initializes the Map on `req`. Every subsequent `RequestContext` for the same request finds and reuses that same Map. The framework still creates separate `RequestContext` instances (changing that would require a bigger refactor), but they all share one metadata store.

This is the same trick we used in our workaround, just applied at the framework level. The metadata Map lives on `req` -- the one object all contexts share.

## Migrating to the Fixed API

After upgrading to v1.2.5, the migration was clean. The `authBridgeMiddleware` now uses `ctx.set()` and `ctx.get()` as originally intended:

```typescript
export const authBridgeMiddleware: MiddlewareHandler = (ctx: RequestContext, next) => {
  const user = (ctx.req as any).user;
  if (user) {
    ctx.set('user', user);
  }
  next();
};
```

The `getUser` helper reads from context metadata instead of from `req`:

```typescript
export function getUser(ctx: RequestContext): AuthUser {
  const user = ctx.get<AuthUser>('user');
  if (!user) {
    throw HttpException.unauthorized('Authentication required');
  }
  return user;
}
```

The guards migrated the same way. Here is the workspace membership guard after the fix:

```typescript
export const workspaceMembershipGuard: MiddlewareHandler = async (ctx: RequestContext, next) => {
  const user = ctx.get('user');
  if (!user) {
    throw HttpException.unauthorized('Authentication required');
  }

  const workspaceId = ctx.params.workspaceId;
  if (!workspaceId) return next();

  const container = Container.getInstance();
  const memberRepo = container.resolve<IWorkspaceMemberRepository>(
    TOKENS.WORKSPACE_MEMBER_REPOSITORY,
  );
  const member = await memberRepo.findByUserAndWorkspace(user.id, workspaceId);

  if (!member) {
    throw HttpException.forbidden(ErrorCode.NOT_WORKSPACE_MEMBER);
  }

  ctx.set('workspaceMember', member);
  next();
};
```

The project access guard chains nicely with this, setting both the project and the workspace member on the shared context:

```typescript
export const projectAccessGuard: MiddlewareHandler = async (ctx: RequestContext, next) => {
  const user = ctx.get('user');
  if (!user) {
    throw HttpException.unauthorized('Authentication required');
  }

  const projectId = ctx.params.projectId;
  if (!projectId) return next();

  const container = Container.getInstance();
  const projectRepo = container.resolve<IProjectRepository>(TOKENS.PROJECT_REPOSITORY);
  const project = await projectRepo.findById(projectId);

  if (!project) {
    throw HttpException.notFound(ErrorCode.PROJECT_NOT_FOUND);
  }

  const memberRepo = container.resolve<IWorkspaceMemberRepository>(
    TOKENS.WORKSPACE_MEMBER_REPOSITORY,
  );
  const member = await memberRepo.findByUserAndWorkspace(
    user.id,
    project.workspaceId.toString(),
  );

  if (!member) {
    throw HttpException.forbidden(ErrorCode.NOT_WORKSPACE_MEMBER);
  }

  ctx.set('project', project);
  ctx.set('workspaceMember', member);
  next();
};
```

Handlers read everything through `ctx.get()` with proper generics:

```typescript
@Controller()
@Middleware(authBridgeMiddleware)
export class TasksController {
  @Post('/projects/:projectId/tasks', {
    params: z.object({ projectId: z.string() }),
    body: createTaskSchema,
  })
  @Middleware(projectAccessGuard)
  async create(ctx: RequestContext) {
    const user = ctx.get('user');
    const result = await this.createTaskUseCase.execute(
      ctx.params.projectId,
      user.id,
      ctx.body,
    );
    ctx.created(successResponse(result, 'Task created'));
  }
}
```

## The Helper Pattern Is Still Worth Keeping

Even with the fix, I kept the `getUser(ctx)` helper. Here is why:

1. **It throws on missing auth.** A bare `ctx.get('user')` returns `undefined` if the middleware did not run. The helper throws a 401, which is always what I want.

2. **It provides a typed return.** `ctx.get<AuthUser>('user')` returns `AuthUser | undefined`. The helper returns `AuthUser` -- no optional chaining needed downstream.

3. **It is a single migration point.** If the storage mechanism changes again, I update one function.

This is a general pattern worth adopting for any per-request data that middleware populates and handlers consume. Wrap the retrieval in a typed helper that fails explicitly when the data is missing.

## The Takeaway: Framework Abstractions Can Leak

The lesson here goes beyond KickJS. Every framework that wraps underlying primitives has seams where the abstraction can come apart. Express middleware communicates through `req` mutation. When a framework builds a nicer API on top of that (`ctx.set()`/`ctx.get()`), it needs to preserve the same sharing semantics.

When you hit a bug like this, the debugging process is:

1. **Verify the contract.** Does the framework docs say `ctx.set()` in middleware should be visible to `ctx.get()` in the handler? Yes.
2. **Test the implementation.** Add logs in both places. Is the data actually there? No.
3. **Read the framework source.** How does it create the context objects? Ah -- separate instances.
4. **Work around at the shared layer.** What do all contexts have in common? The `req` object.
5. **Push the fix upstream.** File the issue with a proposed solution. In this case, the fix was 5 lines of code.

Understanding what sits underneath your framework abstractions is not optional. It is the difference between three hours of confusion and a targeted fix. The abstraction is there to make the common case easy, but when it breaks, you need to know what `req` and `res` are actually doing.

Build your helpers to contain the workaround. When the fix lands, you change one file instead of fifty.
