# KICK-016: `@Service()` + `@Job()` classes not auto-registered in DI container

- **Status**: Released
- **Severity**: High
- **Found in**: v1.2.5
- **Fixed in**: v1.2.6
- **Component**: queue, core

## Description
Classes decorated with both `@Service()` and `@Job('queueName')` are not automatically registered in the DI container. When `QueueAdapter.beforeStart()` runs, it iterates the `jobRegistry` (populated by `@Job()`) and calls `container.resolve(jobClass)`. This fails with "No binding found" because `@Service()` only sets metadata — it does not call `container.register()`.

This means `@Job` processors require a manual workaround to register them in the container before `QueueAdapter` tries to resolve them.

## Steps to Reproduce
1. Create a processor class with both decorators:
   ```ts
   @Service()
   @Job('email')
   export class EmailProcessor {
     @Process('send-welcome')
     async sendWelcome(job: BullMQJob) { ... }
   }
   ```
2. Add `QueueAdapter` with `queues: ['email']` to the adapters array
3. Start the application

## Expected Behavior
`@Service()` (or `@Job()` itself) should ensure the class is registered in the DI container so `QueueAdapter.beforeStart()` can resolve it without any manual registration step.

## Actual Behavior
```
Error: No binding found for: EmailProcessor
    at Container.resolve (container.ts:105:13)
    at QueueAdapter.beforeStart (queue.adapter.ts:75:35)
```

## Environment
- Node.js version: v24.x
- OS: Linux (Ubuntu)
- Package manager: pnpm

## Workaround
Create a custom adapter that explicitly registers processor classes before `QueueAdapter` in the adapters array:

```ts
export class ProcessorRegistrarAdapter implements AppAdapter {
  name = 'ProcessorRegistrarAdapter';

  beforeStart(_app: any, container: Container) {
    if (!container.has(EmailProcessor)) {
      container.register(EmailProcessor, EmailProcessor);
    }
  }
}

// In adapters array — MUST come before queueAdapter
export const adapters = [
  // ...
  new ProcessorRegistrarAdapter(),
  queueAdapter,
  // ...
];
```

## Suggested Fix
Option A: `@Job()` decorator should auto-register the class in the container (similar to how `@Controller()` classes are resolved).

Option B: `QueueAdapter.beforeStart()` should auto-register `@Job` classes from the `jobRegistry` before trying to resolve them:
```ts
for (const jobClass of jobRegistry) {
  if (!container.has(jobClass)) {
    container.register(jobClass, jobClass);
  }
  const processor = container.resolve(jobClass);
  // ...
}
```

Option B is the simplest fix and keeps the change localized to `QueueAdapter`.

## References
- Related: KICK-013 (HMR identity issue is a separate but compounding problem)
- framework-issues.md section
