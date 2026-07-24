import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';

export interface HealthResult {
  status: 'ok' | 'degraded';
  uptime: number;
  checks: { db: 'ok' | 'fail'; redis: 'ok' | 'fail' };
  ts: string;
}

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<HealthResult> {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);

    const allOk = db === 'ok' && redis === 'ok';
    return {
      status: allOk ? 'ok' : 'degraded',
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      checks: { db, redis },
      ts: new Date().toISOString(),
    };
  }

  private async checkDb(): Promise<'ok' | 'fail'> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'ok';
    } catch {
      return 'fail';
    }
  }

  private async checkRedis(): Promise<'ok' | 'fail'> {
    const client = new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 0,
    });
    try {
      await client.connect();
      await client.ping();
      return 'ok';
    } catch {
      return 'fail';
    } finally {
      client.disconnect();
    }
  }
}
