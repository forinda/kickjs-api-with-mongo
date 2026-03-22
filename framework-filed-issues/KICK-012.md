# KICK-012: DevToolsAdapter `peerAdapters` lost on HMR rebuild

- **Status**: Open
- **Severity**: Low
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: devtools

## Description
`DevToolsAdapter` stores `options.adapters` (its peer adapter references) in the constructor at initialization time. On an HMR rebuild, `g.__app.rebuild()` reuses the old adapter instances while re-evaluated code produces new adapter instances. The new instances are never passed to the old `DevToolsAdapter`, so its peer references become stale. Debug endpoints like `/_debug/queues` and `/_debug/ws` return "not found" after HMR even though the underlying services are still running.

## Steps to Reproduce
1. Start the app with `kick dev` (HMR enabled)
2. Verify `/_debug/queues` and `/_debug/ws` return valid data
3. Edit a source file to trigger an HMR rebuild
4. Hit `/_debug/queues` or `/_debug/ws` again
5. Endpoints return "not found" or empty responses

## Expected Behavior
DevTools debug endpoints should continue to work after HMR rebuilds, reflecting the current state of running services.

## Actual Behavior
After HMR rebuild, `/_debug/queues` and `/_debug/ws` show "not found" because `DevToolsAdapter` holds references to old adapter instances that are no longer connected to the live services.

## Error / Stack Trace
```
GET /_debug/queues 404 (Not Found)
{
  "statusCode": 404,
  "message": "Debug endpoint not available — adapter not found"
}
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Perform a full restart of `kick dev` instead of relying on HMR when debugging queue or WebSocket state.

## Suggested Fix
Instead of capturing peer adapters at construction time, discover them from the app registry at request time. This way `DevToolsAdapter` always resolves the current live adapter instances regardless of HMR cycles.

## References
- framework-issues.md section
