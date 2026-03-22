import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
import { buildRoutes } from '@forinda/kickjs-http';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoRefreshTokenRepository } from './infrastructure/repositories/mongo-refresh-token.repository';
import { AuthController } from './presentation/auth.controller';

export class AuthModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.REFRESH_TOKEN_REPOSITORY, () =>
      container.resolve(MongoRefreshTokenRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/auth',
      router: buildRoutes(AuthController),
      controller: AuthController,
    };
  }
}
