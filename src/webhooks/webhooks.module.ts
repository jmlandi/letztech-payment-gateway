import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhooksController } from './webhooks.controller';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';
import { OutboxEvent } from '../outbox/entities/outbox.entity';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookEndpoint, OutboxEvent]), PaymentsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
