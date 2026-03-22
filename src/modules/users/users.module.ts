import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
import { buildRoutes } from '@forinda/kickjs-http';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoUserRepository } from './infrastructure/repositories/mongo-user.repository';
import { UsersController } from './presentation/users.controller';

export class UsersModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.USER_REPOSITORY, () =>
      container.resolve(MongoUserRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/users',
      router: buildRoutes(UsersController),
      controller: UsersController,
    };
  }
}
