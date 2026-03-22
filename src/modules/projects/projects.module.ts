import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
import { buildRoutes } from '@forinda/kickjs-http';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoProjectRepository } from './infrastructure/repositories/mongo-project.repository';
import { ProjectsController } from './presentation/projects.controller';

export class ProjectsModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.PROJECT_REPOSITORY, () =>
      container.resolve(MongoProjectRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(ProjectsController),
      controller: ProjectsController,
    };
  }
}
