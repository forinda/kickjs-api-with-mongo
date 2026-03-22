import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
import { buildRoutes } from '@forinda/kickjs-http';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoLabelRepository } from './infrastructure/repositories/mongo-label.repository';
import { LabelsController } from './presentation/labels.controller';

export class LabelsModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.LABEL_REPOSITORY, () =>
      container.resolve(MongoLabelRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(LabelsController),
      controller: LabelsController,
    };
  }
}
