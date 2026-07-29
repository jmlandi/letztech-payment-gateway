import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';

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

import { WakeModule } from './wake/wake.module';
import { WooCommerceModule } from './woocommerce/woocommerce.module';
import { PaymentsModule } from './payments/payments.module';
import { StoresModule } from './stores/stores.module';
import { RiskModule } from './risk/risk.module';
import { ProvidersModule } from './providers/providers.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { OutboxModule } from './outbox/outbox.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { AdminModule } from './admin/admin.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';

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
        migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
        synchronize: false,
        logging: config.get('NODE_ENV') === 'development',
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow('REDIS_URL') },
      }),
    }),
    ScheduleModule.forRoot(),
    WakeModule,
    WooCommerceModule,
    PaymentsModule,
    StoresModule,
    RiskModule,
    ProvidersModule,
    IdempotencyModule,
    OutboxModule,
    NotificationsModule,
    WebhooksModule,
    AdminModule,
    HealthModule,
    MetricsModule,
  ],
})
export class AppModule {}
