import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OutboxEvent } from './entities/outbox.entity';

export const NOTIFICATION_QUEUE = 'notifications';

@Injectable()
export class OutboxRelayProcessor {
  private readonly logger = new Logger(OutboxRelayProcessor.name);

  constructor(
    @InjectRepository(OutboxEvent) private readonly outboxRepo: Repository<OutboxEvent>,
    @InjectQueue(NOTIFICATION_QUEUE) private readonly notificationQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async relay(): Promise<void> {
    await this.outboxRepo.manager.transaction(async (em) => {
      const unpublished = await em
        .createQueryBuilder(OutboxEvent, 'o')
        .setLock('pessimistic_partial_write')
        .where({ publishedAt: IsNull() })
        .orderBy('o.created_at', 'ASC')
        .limit(50)
        .getMany();

      if (!unpublished.length) return;

      await Promise.all(
        unpublished.map(async (event) => {
          try {
            await this.notificationQueue.add(
              event.eventType,
              { outboxId: event.id, storeId: event.storeId, eventType: event.eventType, aggregateId: event.aggregateId, payload: event.payload },
              { attempts: 6, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: true },
            );
            await em.update(OutboxEvent, event.id, { publishedAt: new Date() });
          } catch (err) {
            this.logger.error({ outboxId: event.id, err }, 'Failed to enqueue outbox event');
          }
        }),
      );
    });
  }
}
