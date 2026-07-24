import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { PaymentsModule } from '../payments/payments.module';
import { StoresModule } from '../stores/stores.module';

@Module({
  imports: [PaymentsModule, StoresModule],
  controllers: [AdminController],
  providers: [AdminGuard],
})
export class AdminModule {}
