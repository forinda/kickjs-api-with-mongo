# KICK-010: `@Public()` not respected — AuthAdapter `resolveHandler` fails at `beforeRoutes` phase

- **Status**: Open
- **Severity**: Critical
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: auth

## Description
AuthAdapter middleware runs at the `beforeRoutes` phase. Its `resolveHandler(req)` checks `req.route`, which is `undefined` at that phase because routes have not been mounted yet. This causes `resolveHandler` to return `{ controllerClass: undefined, handlerName: undefined }`. When `isAuthRequired()` receives no controller metadata, it falls through to the `defaultPolicy`. With `defaultPolicy: 'protected'`, ALL requests receive a 401 — including routes explicitly decorated with `@Public()`.

## Steps to Reproduce
1. Configure `AuthAdapter` with `defaultPolicy: 'protected'`
2. Add the `@Public()` decorator on a route handler
3. Send a request to the public route without an authorization token
4. Receive a `401 Unauthorized` response

## Expected Behavior
Routes decorated with `@Public()` should be accessible without authentication, regardless of the `defaultPolicy` setting. The auth middleware should read the decorator metadata and skip token validation for public routes.

## Actual Behavior
All requests — including those to `@Public()` routes — receive a `401 Unauthorized` response when `defaultPolicy` is set to `'protected'`. The `@Public()` decorator is effectively ignored.

## Error / Stack Trace
```
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "statusCode": 401,
  "message": "Authentication required",
  "error": "Unauthorized"
}
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Set `defaultPolicy: 'open'` and handle authentication manually in a custom `authBridgeMiddleware` applied per controller or per route, rather than relying on the global AuthAdapter.

## Suggested Fix
Move the auth middleware to the `afterRoutes` phase so that `req.route` is populated when `resolveHandler` runs. Alternatively, defer handler resolution to request time when `req.route` is guaranteed to exist.

## References
- framework-issues.md section
