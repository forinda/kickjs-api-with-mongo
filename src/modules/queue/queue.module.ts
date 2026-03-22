import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
// Side-effect imports ensure @Job() decorators populate the jobRegistry
import './infrastructure/processors/email.processor';
import './infrastructure/processors/notification.processor';
import './infrastructure/processors/activity.processor';

export class QueueModule implements AppModule {
  register(_container: Container): void {
    // No manual registration needed — QueueAdapter v1.2.6+ auto-registers
    // @Job classes in the container before resolving them.
  }

  routes(): ModuleRoutes | null {
    return null;
  }
}
