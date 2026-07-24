import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { OutboxEvent } from './entities/outbox.entity';
import { OutboxRelayProcessor, NOTIFICATION_QUEUE } from './outbox-relay.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEvent]),
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
  ],
  providers: [OutboxRelayProcessor],
  exports: [BullModule],
})
export class OutboxModule {}
