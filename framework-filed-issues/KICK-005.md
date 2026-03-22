# KICK-005: QueueAdapter `queues` expects strings, docs show classes

- **Status**: Open
- **Severity**: Medium
- **Found in**: v1.2.2
- **Fixed in**: —
- **Component**: queue

## Description
The KickJS documentation shows passing processor classes to the `queues` option of `QueueAdapter` (e.g., `queues: [EmailProcessor]`), but the actual TypeScript type for `queues` is `string[]`. Passing class references causes a runtime crash in BullMQ's `QueueBase` constructor because it attempts to call `name.includes()` on a class/function object instead of a string.

## Steps to Reproduce
1. Define a queue processor class: `class EmailProcessor { ... }`
2. Configure the queue adapter following the docs:
   ```ts
   QueueAdapter.create({
     queues: [EmailProcessor],
     connection: { host: 'localhost', port: 6379 },
   });
   ```
3. Start the application.

## Expected Behavior
Either the docs should show the correct usage (passing string names), or the framework should accept class references and extract queue names automatically.

## Actual Behavior
Runtime crash:
```
TypeError: name.includes is not a function
    at new QueueBase (node_modules/bullmq/src/classes/queue-base.ts:XX:XX)
```

## Error / Stack Trace
```
TypeError: name.includes is not a function
    at new QueueBase (node_modules/bullmq/src/classes/queue-base.ts:XX:XX)
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Pass string queue names instead of class references:
```ts
QueueAdapter.create({
  queues: ['email', 'notifications'],
  connection: { host: 'localhost', port: 6379 },
});
```

## Suggested Fix
Either update the documentation to show passing string names, or update the `QueueAdapter` to accept `Function[] | string[]` and extract `.name` from class references when functions are provided.

## References
- framework-issues.md section
