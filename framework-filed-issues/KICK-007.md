# KICK-007: Route path doubling: module path + controller path

- **Status**: Open
- **Severity**: High
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: http

## Description
When a module's `routes()` method returns `{ path: '/users' }` and the controller is decorated with `@Controller('/users')`, the framework concatenates both paths, producing doubled route prefixes like `/api/v1/users/users/me` instead of the expected `/api/v1/users/me`.

## Steps to Reproduce
1. Create a module whose `routes()` returns `{ path: '/users', router }`.
2. Create a controller decorated with `@Controller('/users')`.
3. Add a route method decorated with `@Get('/me')`.
4. Start the application and send a request to `GET /api/v1/users/me`.

## Expected Behavior
The route resolves at `/api/v1/users/me`.

## Actual Behavior
The route is registered at `/api/v1/users/users/me`. Requests to `/api/v1/users/me` return 404.

## Error / Stack Trace
```
No error thrown — routes are silently registered at the wrong path.
GET /api/v1/users/me → 404 Not Found
GET /api/v1/users/users/me → 200 OK
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Use `@Controller()` with no path argument (or an empty string) when the module's `routes()` already sets the base path:
```ts
@Controller()
export class UsersController { ... }
```

## Suggested Fix
Either deduplicate overlapping path segments when merging module and controller paths, or update the code generator to emit `@Controller()` without a path argument when the module already defines the route prefix.

## References
- framework-issues.md section
