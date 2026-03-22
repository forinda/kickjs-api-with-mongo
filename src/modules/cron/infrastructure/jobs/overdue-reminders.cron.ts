import { Service } from '@forinda/kickjs-core';
import { Cron } from '@forinda/kickjs-cron';
import { Container, Logger } from '@forinda/kickjs-core';
import { TOKENS } from '@/shared/constants/tokens';
import type { ITaskRepository } from '@/modules/tasks/domain/repositories/task.repository';
import type { IUserRepository } from '@/modules/users/domain/repositories/user.repository';
import type { QueueService } from '@forinda/kickjs-queue';

const logger = Logger.for('TaskCronJobs');

@Service()
export class TaskCronJobs {
  @Cron('0 9 * * *', { description: 'Send overdue task reminders', timezone: 'UTC' })
  async overdueReminders() {
    logger.info('Running overdue task reminders...');
    const container = Container.getInstance();
    const taskRepo = container.resolve<ITaskRepository>(TOKENS.TASK_REPOSITORY);
    const userRepo = container.resolve<IUserRepository>(TOKENS.USER_REPOSITORY);
    const queueService = container.resolve<QueueService>(TOKENS.QUEUE_SERVICE);

    const overdueTasks = await taskRepo.findOverdue();
    for (const task of overdueTasks) {
      for (const assigneeId of task.assigneeIds) {
        const user = await userRepo.findById(assigneeId.toString());
        if (user) {
          await queueService.add('email', 'send-overdue-reminder', {
            email: user.email,
            taskKey: task.key,
            taskTitle: task.title,
            dueDate: task.dueDate?.toISOString(),
          });
        }
      }
    }
    logger.info(`Sent reminders for ${overdueTasks.length} overdue tasks`);
  }
}
