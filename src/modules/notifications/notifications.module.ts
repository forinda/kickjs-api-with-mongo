import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
import { buildRoutes } from '@forinda/kickjs-http';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoNotificationRepository } from './infrastructure/repositories/mongo-notification.repository';
import { NotificationsController } from './presentation/notifications.controller';

export class NotificationsModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.NOTIFICATION_REPOSITORY, () =>
      container.resolve(MongoNotificationRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/notifications',
      router: buildRoutes(NotificationsController),
      controller: NotificationsController,
    };
  }
}
