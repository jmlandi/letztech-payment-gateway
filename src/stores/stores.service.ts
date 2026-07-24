import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { Store } from './entities/store.entity';
import { StoreCredentials } from './entities/store-credentials.entity';
import { StoreSettings } from './entities/store-settings.entity';
import { generateId } from '../common/utils/id';
import { constantTimeCompare } from '../common/utils/constant-time-compare';

export interface ResolvedStore {
  store: Store;
  settings: StoreSettings;
}

@Injectable()
export class StoresService {
  constructor(
    @InjectRepository(Store) private readonly storeRepo: Repository<Store>,
    @InjectRepository(StoreCredentials) private readonly credsRepo: Repository<StoreCredentials>,
    @InjectRepository(StoreSettings) private readonly settingsRepo: Repository<StoreSettings>,
  ) {}

  async resolveByWakeHeaders(wakeStoreHeader: string, apiKey: string): Promise<ResolvedStore> {
    const store = await this.storeRepo.findOne({ where: { wakeStoreHeader } });
    if (!store) throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Invalid store credentials' } });

    const creds = await this.credsRepo.findOne({
      where: { storeId: store.id, revokedAt: undefined as never },
      order: { createdAt: 'DESC' },
    });
    if (!creds) throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Invalid store credentials' } });

    const valid = await argon2.verify(creds.apiKeyHash, apiKey);
    if (!valid) throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Invalid store credentials' } });

    const settings = await this.settingsRepo.findOneOrFail({ where: { storeId: store.id } });
    return { store, settings };
  }

  async resolveByApiKey(bearerKey: string): Promise<ResolvedStore> {
    const allCreds = await this.credsRepo.find({ where: { revokedAt: undefined as never } });
    for (const cred of allCreds) {
      if (await argon2.verify(cred.apiKeyHash, bearerKey)) {
        const store = await this.storeRepo.findOneOrFail({ where: { id: cred.storeId } });
        const settings = await this.settingsRepo.findOneOrFail({ where: { storeId: store.id } });
        return { store, settings };
      }
    }
    throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Invalid API key' } });
  }

  async createStore(name: string): Promise<{ store: Store; apiKey: string; hmacSecret: string }> {
    const store = this.storeRepo.create({ id: generateId('str'), name, wakeStoreHeader: null });
    await this.storeRepo.save(store);

    const apiKey = generateId('key');
    const hmacSecret = generateId('sec');

    const creds = this.credsRepo.create({
      id: generateId('crd'),
      storeId: store.id,
      apiKeyHash: await argon2.hash(apiKey),
      hmacSecretHash: await argon2.hash(hmacSecret),
    });
    await this.credsRepo.save(creds);

    const settings = this.settingsRepo.create({
      id: generateId('sts'),
      storeId: store.id,
      fraudEnabled: false,
      koinPrivateKeyEncrypted: null,
      zoopSellerId: null,
      enabledMethods: ['pix', 'boleto', 'credit_card'],
    });
    await this.settingsRepo.save(settings);

    return { store, apiKey, hmacSecret };
  }

  async updateSettings(storeId: string, patch: Partial<Pick<StoreSettings, 'fraudEnabled' | 'koinPrivateKeyEncrypted' | 'zoopSellerId' | 'enabledMethods'>>): Promise<StoreSettings> {
    const settings = await this.settingsRepo.findOneOrFail({ where: { storeId } });
    Object.assign(settings, patch);
    return this.settingsRepo.save(settings);
  }

  async findById(id: string): Promise<Store> {
    const store = await this.storeRepo.findOne({ where: { id } });
    if (!store) throw new NotFoundException({ error: { code: 'not_found', message: 'Store not found' } });
    return store;
  }
}
