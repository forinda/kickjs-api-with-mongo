import { Repository } from '@forinda/kickjs-core';
import type { IAttachmentRepository } from '../../domain/repositories/attachment.repository';
import type { AttachmentEntity } from '../../domain/entities/attachment.entity';
import { AttachmentModel } from '../schemas/attachment.schema';

@Repository()
export class MongoAttachmentRepository implements IAttachmentRepository {
  async findById(id: string): Promise<AttachmentEntity | null> {
    return AttachmentModel.findById(id).lean() as any;
  }

  async findByTask(taskId: string): Promise<AttachmentEntity[]> {
    return AttachmentModel.find({ taskId }).sort({ createdAt: -1 }).lean() as any;
  }

  async create(data: Partial<AttachmentEntity>): Promise<AttachmentEntity> {
    const doc = await AttachmentModel.create(data);
    return doc.toObject() as any;
  }

  async delete(id: string): Promise<boolean> {
    const result = await AttachmentModel.findByIdAndDelete(id);
    return !!result;
  }
}
