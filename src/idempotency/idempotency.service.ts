import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { generateId } from '../common/utils/id';

const TTL_MS = 48 * 60 * 60 * 1000;

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly repo: Repository<IdempotencyKey>,
  ) {}

  async getOrCreate(
    storeId: string,
    key: string,
    requestHash: string,
  ): Promise<{ existing: boolean; record: IdempotencyKey }> {
    const keyHash = hash(key);
    const existing = await this.repo.findOne({ where: { storeId, keyHash } });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException({
          error: { code: 'idempotency_conflict', message: 'Same key used with a different request payload' },
        });
      }
      return { existing: true, record: existing };
    }

    const record = this.repo.create({
      id: generateId('idk'),
      storeId,
      keyHash,
      requestHash,
      response: null,
      expiresAt: new Date(Date.now() + TTL_MS),
    });
    await this.repo.save(record);
    return { existing: false, record };
  }

  async saveResponse(id: string, response: Record<string, unknown>): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ response: () => `'${JSON.stringify(response)}'::jsonb` })
      .where('id = :id', { id })
      .execute();
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
