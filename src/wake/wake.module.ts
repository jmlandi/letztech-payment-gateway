import { Module } from '@nestjs/common';
import { WakeController } from './wake.controller';
import { WakeService } from './wake.service';
import { PaymentsModule } from '../payments/payments.module';
import { StoresModule } from '../stores/stores.module';
import { RiskModule } from '../risk/risk.module';
import { ProvidersModule } from '../providers/providers.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';

@Module({
  imports: [PaymentsModule, StoresModule, RiskModule, ProvidersModule, IdempotencyModule],
  controllers: [WakeController],
  providers: [WakeService],
})
export class WakeModule {}
