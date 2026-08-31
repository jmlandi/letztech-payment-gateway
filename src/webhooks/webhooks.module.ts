import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhooksController } from './webhooks.controller';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';
import { OutboxEvent } from '../outbox/entities/outbox.entity';
import { PaymentsModule } from '../payments/payments.module';
import { StoresModule } from '../stores/stores.module';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookEndpoint, OutboxEvent]), PaymentsModule, StoresModule, RiskModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
