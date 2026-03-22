import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
import { buildRoutes } from '@forinda/kickjs-http';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoCommentRepository } from './infrastructure/repositories/mongo-comment.repository';
import { CommentsController } from './presentation/comments.controller';

export class CommentsModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.COMMENT_REPOSITORY, () =>
      container.resolve(MongoCommentRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(CommentsController),
      controller: CommentsController,
    };
  }
}
