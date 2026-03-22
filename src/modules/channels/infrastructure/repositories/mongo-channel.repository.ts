import { Repository } from '@forinda/kickjs-core';
import type { IChannelRepository } from '../../domain/repositories/channel.repository';
import type { ChannelEntity } from '../../domain/entities/channel.entity';
import { ChannelModel } from '../schemas/channel.schema';

@Repository()
export class MongoChannelRepository implements IChannelRepository {
  async findById(id: string): Promise<ChannelEntity | null> {
    return ChannelModel.findById(id).lean() as any;
  }

  async findByWorkspace(workspaceId: string): Promise<ChannelEntity[]> {
    return ChannelModel.find({ workspaceId }).sort({ name: 1 }).lean() as any;
  }

  async findByNameAndWorkspace(name: string, workspaceId: string): Promise<ChannelEntity | null> {
    return ChannelModel.findOne({ name, workspaceId }).lean() as any;
  }

  async create(data: Partial<ChannelEntity>): Promise<ChannelEntity> {
    const doc = await ChannelModel.create(data);
    return doc.toObject() as any;
  }

  async update(id: string, data: Partial<ChannelEntity>): Promise<ChannelEntity | null> {
    return ChannelModel.findByIdAndUpdate(id, { $set: data }, { new: true }).lean() as any;
  }

  async delete(id: string): Promise<boolean> {
    const result = await ChannelModel.findByIdAndDelete(id);
    return !!result;
  }

  async addMember(channelId: string, userId: string) {
    await ChannelModel.findByIdAndUpdate(channelId, { $addToSet: { memberIds: userId } });
  }

  async removeMember(channelId: string, userId: string) {
    await ChannelModel.findByIdAndUpdate(channelId, { $pull: { memberIds: userId } });
  }
}
