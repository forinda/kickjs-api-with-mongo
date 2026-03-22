import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
import { buildRoutes } from '@forinda/kickjs-http';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoMessageRepository } from './infrastructure/repositories/mongo-message.repository';
import { MessagesController } from './presentation/messages.controller';

export class MessagesModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.MESSAGE_REPOSITORY, () =>
      container.resolve(MongoMessageRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(MessagesController),
      controller: MessagesController,
    };
  }
}
