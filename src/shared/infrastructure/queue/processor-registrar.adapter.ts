import type { AppAdapter, Container } from '@forinda/kickjs-core';
import { EmailProcessor } from '@/modules/queue/infrastructure/processors/email.processor';
import { NotificationProcessor } from '@/modules/queue/infrastructure/processors/notification.processor';
import { ActivityProcessor } from '@/modules/queue/infrastructure/processors/activity.processor';

/**
 * Registers queue job processor classes in the DI container
 * before QueueAdapter.beforeStart() tries to resolve them.
 */
export class ProcessorRegistrarAdapter implements AppAdapter {
  name = 'ProcessorRegistrarAdapter';

  beforeStart(_app: any, container: Container) {
    // Ensure processor classes are registered in the container.
    // @Service() decorator auto-registers them, but we force resolution
    // here to guarantee they exist before QueueAdapter needs them.
    if (!container.has(EmailProcessor)) {
      container.register(EmailProcessor, EmailProcessor);
    }
    if (!container.has(NotificationProcessor)) {
      container.register(NotificationProcessor, NotificationProcessor);
    }
    if (!container.has(ActivityProcessor)) {
      container.register(ActivityProcessor, ActivityProcessor);
    }
  }
}
