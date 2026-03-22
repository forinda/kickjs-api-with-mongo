# KICK-008: Global middleware receives Express handler, not RequestContext

- **Status**: Open
- **Severity**: Medium
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: http

## Description
The `bootstrap({ middleware: [...] })` configuration accepts raw Express middleware with the signature `(req, res, next)`, not the KickJS `MiddlewareHandler` signature `(ctx, next)`. This is undocumented and inconsistent with route-level middleware registered via the `@Middleware` decorator, which uses the KickJS `RequestContext` pattern. Writing global middleware with the wrong signature causes runtime crashes.

## Steps to Reproduce
1. Write a middleware using the KickJS `MiddlewareHandler` signature:
   ```ts
   const myMiddleware: MiddlewareHandler = (ctx, next) => {
     console.log(ctx.req.headers);
     next();
   };
   ```
2. Register it globally:
   ```ts
   bootstrap({ middleware: [myMiddleware] });
   ```
3. Start the application and send any HTTP request.

## Expected Behavior
Global middleware should accept the same `MiddlewareHandler` `(ctx, next)` signature used by `@Middleware`-decorated route-level middleware, or the difference should be clearly documented.

## Actual Behavior
The middleware receives raw Express `(req, res, next)` arguments. Accessing `ctx.req` fails because `ctx` is actually the Express `req` object, not a `RequestContext`.

## Error / Stack Trace
```
TypeError: Cannot read properties of undefined (reading 'headers')
    at myMiddleware (src/middleware/my-middleware.ts:XX:XX)
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Use the Express `(req, res, next)` signature for global middleware registered via `bootstrap()`, and use the KickJS `(ctx, next)` signature only for `@Middleware`-decorated route-level middleware:
```ts
// Global middleware — Express signature
const globalMiddleware = (req: Request, res: Response, next: NextFunction) => {
  console.log(req.headers);
  next();
};

bootstrap({ middleware: [globalMiddleware] });
```

## Suggested Fix
Either normalize both global and route-level middleware to use the same `MiddlewareHandler` `(ctx, next)` signature, or clearly document the difference in the KickJS docs and type definitions.

## References
- framework-issues.md section
