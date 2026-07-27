import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { Store } from './entities/store.entity';
import { StoreCredentials } from './entities/store-credentials.entity';
import { StoreSettings } from './entities/store-settings.entity';
import { generateId } from '../common/utils/id';
import { slugify } from '../common/utils/slug';
import { ProvidersService } from '../providers/providers.service';

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
    private readonly providersService: ProvidersService,
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

  private async assertSlugAvailable(slug: string, excludeStoreId?: string): Promise<void> {
    const existing = await this.storeRepo.findOne({ where: { wakeStoreHeader: slug } });
    if (existing && existing.id !== excludeStoreId) {
      throw new ConflictException({ error: { code: 'slug_taken', message: 'A store with this slug already exists' } });
    }
  }

  private async assertNameAvailable(name: string, excludeStoreId?: string): Promise<void> {
    const existing = await this.storeRepo.findOne({ where: { name } });
    if (existing && existing.id !== excludeStoreId) {
      throw new ConflictException({ error: { code: 'name_taken', message: 'A store with this name already exists' } });
    }
  }

  private async assertSellerExists(zoopSellerId: string): Promise<void> {
    const exists = await this.providersService.verifySeller(zoopSellerId);
    if (!exists) {
      throw new BadRequestException({ error: { code: 'seller_not_found', message: 'zoopSellerId does not exist on the Zoop marketplace' } });
    }
  }

  async createStore(name: string, slug: string, zoopSellerId?: string): Promise<{ store: Store; apiKey: string; hmacSecret: string }> {
    const wakeStoreHeader = slugify(slug);
    if (!wakeStoreHeader) {
      throw new ConflictException({ error: { code: 'invalid_slug', message: 'Slug must contain at least one alphanumeric character' } });
    }

    await this.assertNameAvailable(name);
    await this.assertSlugAvailable(wakeStoreHeader);
    if (zoopSellerId) await this.assertSellerExists(zoopSellerId);

    const store = this.storeRepo.create({ id: generateId('str'), name, wakeStoreHeader });
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
      zoopSellerId: zoopSellerId ?? null,
      enabledMethods: ['pix', 'boleto', 'credit_card'],
    });
    await this.settingsRepo.save(settings);

    return { store, apiKey, hmacSecret };
  }

  async updateSettings(storeId: string, patch: Partial<Pick<StoreSettings, 'fraudEnabled' | 'koinPrivateKeyEncrypted' | 'zoopSellerId' | 'enabledMethods'>>): Promise<StoreSettings> {
    const settings = await this.settingsRepo.findOneOrFail({ where: { storeId } });
    if (patch.zoopSellerId) await this.assertSellerExists(patch.zoopSellerId);
    Object.assign(settings, patch);
    return this.settingsRepo.save(settings);
  }

  async findById(id: string): Promise<Store> {
    const store = await this.storeRepo.findOne({ where: { id } });
    if (!store) throw new NotFoundException({ error: { code: 'not_found', message: 'Store not found' } });
    return store;
  }

  async updateSlug(storeId: string, slug: string): Promise<Store> {
    const store = await this.findById(storeId);
    const wakeStoreHeader = slugify(slug);
    if (!wakeStoreHeader) {
      throw new ConflictException({ error: { code: 'invalid_slug', message: 'Slug must contain at least one alphanumeric character' } });
    }

    await this.assertSlugAvailable(wakeStoreHeader, storeId);

    store.wakeStoreHeader = wakeStoreHeader;
    return this.storeRepo.save(store);
  }
}
