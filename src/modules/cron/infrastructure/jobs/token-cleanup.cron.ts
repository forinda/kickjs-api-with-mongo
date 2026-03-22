import { Service } from '@forinda/kickjs-core';
import { Cron } from '@forinda/kickjs-cron';
import { Container, Logger } from '@forinda/kickjs-core';
import { TOKENS } from '@/shared/constants/tokens';
import type { IRefreshTokenRepository } from '@/modules/auth/domain/repositories/refresh-token.repository';

const logger = Logger.for('CleanupCronJobs');

@Service()
export class CleanupCronJobs {
  @Cron('0 3 * * *', { description: 'Clean up expired refresh tokens', timezone: 'UTC' })
  async cleanupTokens() {
    logger.info('Running token cleanup...');
    const repo = Container.getInstance().resolve<IRefreshTokenRepository>(TOKENS.REFRESH_TOKEN_REPOSITORY);
    const deleted = await repo.deleteExpired();
    logger.info(`Cleaned up ${deleted} expired refresh tokens`);
  }
}
