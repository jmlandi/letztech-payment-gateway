import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { FraudContext, FraudProvider, FraudVerdict } from '../domain/interfaces/fraud-provider.interface';
import { KoinFraudAdapter } from './adapters/koin/koin-fraud.adapter';
import { NoopFraudProvider } from './adapters/noop/noop-fraud.adapter';
import { StoreSettings } from '../stores/entities/store-settings.entity';

@Injectable()
export class RiskService {
  private readonly sandbox: boolean;

  constructor(private readonly config: ConfigService) {
    this.sandbox = config.get<string>('KOIN_SANDBOX') !== 'false';
  }

  getProvider(settings: StoreSettings): FraudProvider {
    if (!settings.fraudEnabled || !settings.koinPrivateKeyEncrypted) {
      return new NoopFraudProvider();
    }
    const decrypted = this.decryptKoinKey(settings.koinPrivateKeyEncrypted);
    return new KoinFraudAdapter(decrypted, this.sandbox);
  }

  async evaluate(settings: StoreSettings, ctx: FraudContext): Promise<FraudVerdict> {
    const provider = this.getProvider(settings);
    return provider.evaluate(ctx);
  }

  async preEvaluate(settings: StoreSettings, ctx: FraudContext): Promise<FraudVerdict | null> {
    const provider = this.getProvider(settings);
    if (!provider.preEvaluate) return null;
    return provider.preEvaluate(ctx);
  }

  async checkStatus(settings: StoreSettings, referenceId: string): Promise<FraudVerdict> {
    const provider = this.getProvider(settings);
    return provider.checkStatus(referenceId);
  }

  private decryptKoinKey(encrypted: string): string {
    const masterKey = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    const [ivHex, authTagHex, cipherHex] = encrypted.split(':');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(masterKey, 'hex'), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return decipher.update(cipherHex, 'hex', 'utf8') + decipher.final('utf8');
  }

  encryptKoinKey(plaintext: string): string {
    const masterKey = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(masterKey, 'hex'), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }
}
