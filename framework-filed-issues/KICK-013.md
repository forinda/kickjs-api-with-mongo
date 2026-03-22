# KICK-013: `@Job`/`@Service` processor classes lose DI binding on HMR

- **Status**: Open
- **Severity**: Low
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: queue

## Description
When Vite HMR re-evaluates a module, decorated classes like `class EmailProcessor` become NEW JavaScript objects (different identity). The DI container still holds bindings for the OLD class reference. Attempting to resolve the new class via `container.resolve(newEmailProcessor)` fails because the container has no binding registered for the new class identity.

## Steps to Reproduce
1. Create a `@Job`-decorated processor class (e.g., `EmailProcessor`)
2. Start the app with `kick dev` (HMR enabled)
3. Edit the processor file to trigger HMR
4. The framework attempts to resolve the re-evaluated class from the DI container
5. Resolution fails with "No binding found"

## Expected Behavior
DI bindings should survive HMR module re-evaluation. The container should be able to resolve processor classes after HMR without a full restart.

## Actual Behavior
DI resolution fails for any `@Job` or `@Service` class after its module is re-evaluated by HMR, because the new class object has a different identity than the one originally registered.

## Error / Stack Trace
```
Error: No binding found for: EmailProcessor
    at Container.resolve (container.ts:87:13)
    at QueueAdapter.getProcessor (queue-adapter.ts:142:28)
    at QueueAdapter.handleJob (queue-adapter.ts:156:20)
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Ignore the error in development — workers spawned during the initial cold boot continue to run with the old bindings. Perform a full restart of `kick dev` for a clean state when needed.

## Suggested Fix
Use class name strings (or a stable decorator-assigned key) as fallback DI keys to survive HMR identity changes. When resolving by class reference fails, fall back to resolving by the class's `name` property or a `@Job`-assigned identifier.

## References
- framework-issues.md section
