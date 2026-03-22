import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
import { buildRoutes } from '@forinda/kickjs-http';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoActivityRepository } from './infrastructure/repositories/mongo-activity.repository';
import { ActivityController } from './presentation/activity.controller';

export class ActivityModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.ACTIVITY_REPOSITORY, () =>
      container.resolve(MongoActivityRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(ActivityController),
      controller: ActivityController,
    };
  }
}
