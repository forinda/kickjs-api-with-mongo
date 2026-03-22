import { Repository } from '@forinda/kickjs-core';
import type { IWorkspaceMemberRepository } from '../../domain/repositories/workspace-member.repository';
import type { WorkspaceMemberEntity } from '../../domain/entities/workspace-member.entity';
import { WorkspaceMemberModel } from '../schemas/workspace-member.schema';

@Repository()
export class MongoWorkspaceMemberRepository implements IWorkspaceMemberRepository {
  async findByUserAndWorkspace(userId: string, workspaceId: string): Promise<WorkspaceMemberEntity | null> {
    return WorkspaceMemberModel.findOne({ userId, workspaceId }).lean() as any;
  }

  async findByWorkspace(workspaceId: string): Promise<WorkspaceMemberEntity[]> {
    return WorkspaceMemberModel.find({ workspaceId }).lean() as any;
  }

  async findByUser(userId: string): Promise<WorkspaceMemberEntity[]> {
    return WorkspaceMemberModel.find({ userId }).lean() as any;
  }

  async create(data: Partial<WorkspaceMemberEntity>): Promise<WorkspaceMemberEntity> {
    const doc = await WorkspaceMemberModel.create(data);
    return doc.toObject() as any;
  }

  async updateRole(id: string, role: 'admin' | 'member'): Promise<WorkspaceMemberEntity | null> {
    return WorkspaceMemberModel.findByIdAndUpdate(id, { $set: { role } }, { new: true }).lean() as any;
  }

  async delete(id: string): Promise<boolean> {
    const result = await WorkspaceMemberModel.findByIdAndDelete(id);
    return !!result;
  }

  async deleteByUserAndWorkspace(userId: string, workspaceId: string): Promise<boolean> {
    const result = await WorkspaceMemberModel.deleteOne({ userId, workspaceId });
    return result.deletedCount > 0;
  }
}
