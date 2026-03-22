import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
// Import processors so @Service() and @Job() decorators execute and register in DI
export class QueueModule implements AppModule {
  register(_container: Container): void {
    // Processors are auto-registered via @Service() decorator.
    // Imports above ensure decorator side-effects run during module loading.
    // Force reference so tree-shaking doesn't remove them.
    // void EmailProcessor;
    // void NotificationProcessor;
    // void ActivityProcessor;
  }

  routes(): ModuleRoutes {
    return { path: '/', router: undefined as any, controller: undefined as any };
  }
}
