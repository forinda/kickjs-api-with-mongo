import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
import { buildRoutes } from '@forinda/kickjs-http';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoWorkspaceRepository } from './infrastructure/repositories/mongo-workspace.repository';
import { MongoWorkspaceMemberRepository } from './infrastructure/repositories/mongo-workspace-member.repository';
import { WorkspacesController } from './presentation/workspaces.controller';

export class WorkspacesModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.WORKSPACE_REPOSITORY, () =>
      container.resolve(MongoWorkspaceRepository),
    );
    container.registerFactory(TOKENS.WORKSPACE_MEMBER_REPOSITORY, () =>
      container.resolve(MongoWorkspaceMemberRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/workspaces',
      router: buildRoutes(WorkspacesController),
      controller: WorkspacesController,
    };
  }
}
