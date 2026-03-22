# KICK-009: `ctx.set()`/`ctx.get()` not shared between middleware and handler

- **Status**: Open
- **Severity**: Critical
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: http

## Description
In `router-builder.ts`, each class/method middleware and handler receive separate `new RequestContext(req, res, next)` instances. The `metadata` property is a private `new Map()` per instance. This means `ctx.set('user', user)` in middleware is completely invisible to `ctx.get('user')` in the handler, breaking the expected middleware-to-handler data passing pattern.

## Steps to Reproduce
1. Create a middleware that calls `ctx.set('user', userData)` after authentication
2. In the route handler, call `ctx.get('user')` to retrieve the user
3. The call returns `undefined` because the handler has a different `RequestContext` instance with its own empty `Map`

## Expected Behavior
`ctx.get('user')` in the handler should return the same `userData` object that was set via `ctx.set('user', userData)` in the middleware. Context metadata should be shared across the entire request lifecycle.

## Actual Behavior
`ctx.get('user')` returns `undefined` in the handler. Any attempt to access properties on the result throws.

## Error / Stack Trace
```
TypeError: Cannot read properties of undefined (reading 'id')
    at UserController.getProfile (user.controller.ts:42:31)
    at RequestContext.executeHandler (router-builder.ts:118:22)
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Store data directly on the raw request object and use a helper to read it:

```ts
// In middleware
(ctx.req as any).user = userData;

// Helper
function getUser(ctx: RequestContext) {
  return (ctx.req as any).user;
}
```

## Suggested Fix
Share a single `RequestContext` per request OR store the metadata `Map` on the `req` object so all `RequestContext` wrappers created for the same request share the same underlying map.

## References
- framework-issues.md section
