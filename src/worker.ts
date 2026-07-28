import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger as NestLogger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { Logger, LoggerModule } from 'nestjs-pino';

import { loggerParams } from './common/logging/logger.config';

import { Store } from './stores/entities/store.entity';
import { StoreCredentials } from './stores/entities/store-credentials.entity';
import { StoreSettings } from './stores/entities/store-settings.entity';
import { Payment } from './payments/entities/payment.entity';
import { PaymentEvent } from './payments/entities/payment-event.entity';
import { FraudEvaluation } from './payments/entities/fraud-evaluation.entity';
import { ProviderCharge } from './payments/entities/provider-charge.entity';
import { OutboxEvent } from './outbox/entities/outbox.entity';
import { IdempotencyKey } from './idempotency/entities/idempotency-key.entity';
import { WebhookEndpoint } from './webhooks/entities/webhook-endpoint.entity';

import { OutboxModule } from './outbox/outbox.module';
import { NotificationsModule } from './notifications/notifications.module';

const ENTITIES = [
  Store, StoreCredentials, StoreSettings,
  Payment, PaymentEvent, FraudEvaluation, ProviderCharge,
  OutboxEvent, IdempotencyKey, WebhookEndpoint,
];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot(loggerParams()),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow('DATABASE_URL'),
        entities: ENTITIES,
        synchronize: false,
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow('REDIS_URL') },
      }),
    }),
    ScheduleModule.forRoot(),
    OutboxModule,
    NotificationsModule,
  ],
})
class WorkerModule {}

async function bootstrap() {
  const app = await NestFactory.create(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.init();
  new NestLogger('Bootstrap').log('Worker started');
}

bootstrap();
