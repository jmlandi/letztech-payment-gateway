import { Module } from '@nestjs/common';
import { HomologController } from './homolog.controller';
import { HomologService } from './homolog.service';
import { StoresModule } from '../stores/stores.module';
import { WakeModule } from '../wake/wake.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [StoresModule, WakeModule, PaymentsModule],
  controllers: [HomologController],
  providers: [HomologService],
})
export class HomologModule {}
