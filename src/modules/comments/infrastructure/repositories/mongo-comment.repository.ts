import { Repository } from '@forinda/kickjs-core';
import type { ICommentRepository } from '../../domain/repositories/comment.repository';
import type { CommentEntity } from '../../domain/entities/comment.entity';
import { CommentModel } from '../schemas/comment.schema';

@Repository()
export class MongoCommentRepository implements ICommentRepository {
  async findById(id: string): Promise<CommentEntity | null> {
    return CommentModel.findById(id).lean() as any;
  }

  async findByTask(taskId: string): Promise<CommentEntity[]> {
    return CommentModel.find({ taskId }).sort({ createdAt: 1 }).lean() as any;
  }

  async create(data: Partial<CommentEntity>): Promise<CommentEntity> {
    const doc = await CommentModel.create(data);
    return doc.toObject() as any;
  }

  async update(id: string, data: Partial<CommentEntity>): Promise<CommentEntity | null> {
    return CommentModel.findByIdAndUpdate(id, { $set: { ...data, isEdited: true } }, { new: true }).lean() as any;
  }

  async delete(id: string): Promise<boolean> {
    const result = await CommentModel.findByIdAndDelete(id);
    return !!result;
  }
}
