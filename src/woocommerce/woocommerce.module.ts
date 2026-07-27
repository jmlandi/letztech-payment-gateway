import { Module } from '@nestjs/common';
import { WooCommerceController } from './woocommerce.controller';
import { WooCommerceService } from './woocommerce.service';
import { WooCommerceGuard } from './woocommerce.guard';
import { PaymentsModule } from '../payments/payments.module';
import { StoresModule } from '../stores/stores.module';
import { RiskModule } from '../risk/risk.module';
import { ProvidersModule } from '../providers/providers.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';

@Module({
  imports: [PaymentsModule, StoresModule, RiskModule, ProvidersModule, IdempotencyModule],
  controllers: [WooCommerceController],
  providers: [WooCommerceService, WooCommerceGuard],
})
export class WooCommerceModule {}
