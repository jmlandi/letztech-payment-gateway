import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';

/**
 * Imported only by AppModule (the HTTP process), never by WorkerModule —
 * worker.ts never calls .listen(), so there's no HTTP surface to scrape there.
 */
@Module({
  controllers: [MetricsController],
})
export class MetricsModule {}
