# KICK-003: Modules without routes crash Express

- **Status**: Open
- **Severity**: High
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: http

## Description
`AppModule.routes()` must return a `ModuleRoutes` object containing a path and a router. Modules that do not serve HTTP routes (e.g., queue processors, cron jobs) still must implement `routes()`. Returning `{ path: '/', router: undefined as any }` to satisfy the type system causes Express to crash at startup with `TypeError: argument handler must be a function`, because Express expects a valid middleware/router function.

## Steps to Reproduce
1. Create a module (e.g., `QueueModule`) that extends `AppModule` but has no HTTP routes.
2. Implement `routes()` returning `{ path: '/', router: undefined as any }` to satisfy the TypeScript interface.
3. Register this module in the application's module list.
4. Start the application with `kick dev`.

## Expected Behavior
Modules without HTTP routes should be allowed to return `null` or `undefined` from `routes()`, and the framework should skip route registration for those modules.

## Actual Behavior
Express crashes during startup:
```
TypeError: argument handler must be a function
```

## Error / Stack Trace
```
TypeError: argument handler must be a function
    at Object.<anonymous> (node_modules/express/lib/router/index.js:XXX:XX)
    at Module._compile (node:internal/modules/cjs/loader:XXX:XX)
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Do not register route-less modules in the module array. Instead, import queue processors and cron handlers as side-effects outside the module system.

## Suggested Fix
Allow `routes()` to return `null` (update the `ModuleRoutes` return type to `ModuleRoutes | null`). When the framework iterates modules to register routes, skip any module whose `routes()` returns `null`.

## References
- framework-issues.md section
