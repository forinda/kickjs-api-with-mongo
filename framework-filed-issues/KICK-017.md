# KICK-017: `@Service()` decorated classes should be auto-registered in DI container

- **Status**: Released (partial — Option B implemented)
- **Severity**: Medium
- **Found in**: v1.2.5
- **Fixed in**: v1.2.6
- **Component**: core, queue
- **Type**: Feature Request

## Problem
The `@Service()` decorator only sets metadata — it does not register the class in the DI container. Any code that calls `container.resolve(ServiceClass)` fails with "No binding found" unless the consumer manually calls `container.register()`.

This is a generic DI gap that surfaces in multiple places:
- **Queue processors**: `QueueAdapter.beforeStart()` resolves `@Job` classes via `container.resolve()` — fails because `@Service()` didn't register them
- **Standalone services**: Any `@Service()` class not directly `@Autowired` from a controller needs manual registration
- **HMR**: `Application.rebuild()` calls `Container.reset()`, wiping all registrations. Even if manually registered, the fresh container has no bindings

## Current Workaround
A generic `@AutoRegister()` decorator that collects classes in a module-level registry, then a `flushAutoRegister(container)` call from a module's `register()` method (which runs after `Container.reset()` on HMR):

```ts
// Decorator — collects classes for deferred registration
export function AutoRegister(): ClassDecorator {
  return (target: any) => {
    Service()(target);
    registry.push(target);
  };
}

// Called from module.register(container) — runs after Container.reset()
export function flushAutoRegister(container: Container): void {
  for (const target of registry) {
    if (!container.has(target)) {
      container.register(target, target);
    }
  }
}
```

Usage:
```ts
@AutoRegister()
@Job('email')
export class EmailProcessor { ... }

// In module
register(container: Container) {
  flushAutoRegister(container);
}
```

## Proposed Solutions

### Option A: `Container.bootstrap()` auto-registers `@Service()` classes (Recommended)
`@Service()` already stores metadata on the class. `Container.bootstrap()` (which runs inside `setup()` after `Container.reset()`) should scan all `@Service()`-decorated classes and auto-register them if not already bound. This would make `@Service()` work consistently everywhere — no manual registration needed.

```ts
// In Container.bootstrap()
for (const serviceClass of serviceRegistry) {
  if (!this.has(serviceClass)) {
    this.register(serviceClass, serviceClass);
  }
}
```

This is the most generic fix and would eliminate the need for `@AutoRegister()` entirely.

### Option B: Each adapter auto-registers its decorated classes
Adapters that resolve decorated classes (like `QueueAdapter` resolving `@Job` classes) should auto-register them before resolving:

```ts
// In QueueAdapter.beforeStart()
if (!container.has(jobClass)) {
  container.register(jobClass, jobClass);
}
const processor = container.resolve(jobClass);
```

This is the most targeted fix but only solves it per-adapter.

### Option C: `@Service()` registers at decoration time + re-registers in `bootstrap()`
`@Service()` calls `container.register()` immediately (for cold boot) AND stores the class in a registry that `Container.bootstrap()` replays (for HMR survival).

## Benefits
- Zero boilerplate — `@Service()` just works
- Survives HMR rebuilds without custom decorators or adapters
- Consistent behavior: if a class is decorated with `@Service()`, it should be resolvable from the container
- Generic solution that applies to queues, cron, and any future adapter that resolves decorated classes

## References
- Related: KICK-013 (HMR identity issue)
- Related: KICK-016 (original bug report for queue processor registration)
