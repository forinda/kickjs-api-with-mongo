import { Repository } from '@forinda/kickjs-core';
import type { IProjectRepository } from '../../domain/repositories/project.repository';
import type { ProjectEntity } from '../../domain/entities/project.entity';
import { ProjectModel } from '../schemas/project.schema';

@Repository()
export class MongoProjectRepository implements IProjectRepository {
  async findById(id: string): Promise<ProjectEntity | null> {
    return ProjectModel.findById(id).lean() as any;
  }

  async findByWorkspace(workspaceId: string): Promise<ProjectEntity[]> {
    return ProjectModel.find({ workspaceId, isArchived: false }).lean() as any;
  }

  async findByKeyAndWorkspace(key: string, workspaceId: string): Promise<ProjectEntity | null> {
    return ProjectModel.findOne({ key, workspaceId }).lean() as any;
  }

  async create(data: Partial<ProjectEntity>): Promise<ProjectEntity> {
    const doc = await ProjectModel.create(data);
    return doc.toObject() as any;
  }

  async update(id: string, data: Partial<ProjectEntity>): Promise<ProjectEntity | null> {
    return ProjectModel.findByIdAndUpdate(id, { $set: data }, { new: true }).lean() as any;
  }

  async delete(id: string): Promise<boolean> {
    const result = await ProjectModel.findByIdAndUpdate(id, { $set: { isArchived: true } });
    return !!result;
  }

  async incrementTaskCounter(projectId: string): Promise<number> {
    const result = await ProjectModel.findByIdAndUpdate(
      projectId,
      { $inc: { taskCounter: 1 } },
      { new: true },
    );
    return result?.taskCounter ?? 0;
  }
}
