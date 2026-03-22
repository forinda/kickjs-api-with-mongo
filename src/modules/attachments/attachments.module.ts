import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
import { buildRoutes } from '@forinda/kickjs-http';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoAttachmentRepository } from './infrastructure/repositories/mongo-attachment.repository';
import { AttachmentsController } from './presentation/attachments.controller';

export class AttachmentsModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.ATTACHMENT_REPOSITORY, () =>
      container.resolve(MongoAttachmentRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(AttachmentsController),
      controller: AttachmentsController,
    };
  }
}
