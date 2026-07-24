import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import axios from 'axios';
import { NOTIFICATION_QUEUE } from '../outbox/outbox-relay.processor';

interface NotificationJob {
  outboxId: string;
  storeId: string;
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  wakePostbackUrl?: string;
  storeWebhookUrls?: string[];
}

@Processor(NOTIFICATION_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  async process(job: Job<NotificationJob>): Promise<void> {
    const { eventType, aggregateId, payload, wakePostbackUrl, storeWebhookUrls } = job.data;

    this.logger.log({ jobId: job.id, eventType, aggregateId }, 'Processing notification');

    const tasks: Promise<void>[] = [];

    if (wakePostbackUrl) {
      tasks.push(this.sendWakePostback(wakePostbackUrl, payload));
    }

    if (storeWebhookUrls?.length) {
      tasks.push(...storeWebhookUrls.map((url) => this.sendStoreWebhook(url, eventType, aggregateId, payload)));
    }

    await Promise.allSettled(tasks);
  }

  private async sendWakePostback(url: string, payload: Record<string, unknown>): Promise<void> {
    await axios.post(url, payload, { timeout: 10_000 });
  }

  private async sendStoreWebhook(url: string, eventType: string, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
    const event = {
      id: `evt_${Date.now()}`,
      type: eventType,
      created_at: new Date().toISOString(),
      data: payload,
    };
    await axios.post(url, event, {
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
