import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZoopPaymentAdapter, ZoopSeller } from './zoop/zoop-payment.adapter';
import { FAKE_ZOOP_SELLER_ID, FakeZoopProvider } from './zoop/fake-zoop.provider';
import { PaymentProvider } from '../domain/interfaces/payment-provider.interface';
import { StoreSettings } from '../stores/entities/store-settings.entity';

@Injectable()
export class ProvidersService {
  private readonly marketplaceAdapter: ZoopPaymentAdapter;
  private readonly fakeAdapter = new FakeZoopProvider();

  constructor(config: ConfigService) {
    this.marketplaceAdapter = new ZoopPaymentAdapter({
      marketplaceId: config.getOrThrow('ZOOP_MARKETPLACE_ID'),
      publishableKey: config.getOrThrow('ZOOP_PUBLISHABLE_KEY'),
      xApiKey: config.getOrThrow('ZOOP_X_API_KEY'),
      sandbox: config.get('ZOOP_SANDBOX') !== 'false',
      certPath: config.get('ZOOP_CERT_PATH'),
      keyPath: config.get('ZOOP_KEY_PATH'),
    });
  }

  getPaymentProvider(settings: StoreSettings): PaymentProvider {
    if (settings.zoopSellerId === FAKE_ZOOP_SELLER_ID) return this.fakeAdapter;
    return this.marketplaceAdapter;
  }

  verifySeller(sellerId: string): Promise<boolean> {
    return this.marketplaceAdapter.verifySeller(sellerId);
  }

  getSeller(sellerId: string): Promise<ZoopSeller | null> {
    return this.marketplaceAdapter.getSeller(sellerId);
  }
}
