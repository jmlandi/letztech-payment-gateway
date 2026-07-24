import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Store } from './entities/store.entity';
import { StoreCredentials } from './entities/store-credentials.entity';
import { StoreSettings } from './entities/store-settings.entity';
import { StoresService } from './stores.service';

@Module({
  imports: [TypeOrmModule.forFeature([Store, StoreCredentials, StoreSettings])],
  providers: [StoresService],
  exports: [StoresService],
})
export class StoresModule {}
