import * as fs from 'fs';
import * as https from 'https';
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
  ChargeResult,
  CreateChargeCmd,
  Money,
  PaymentProvider,
  RefundResult,
} from '../../domain/interfaces/payment-provider.interface';

// Payment/transaction endpoints moved off api.zoop.ws to a dedicated host after
// Zoop's mTLS rollout; api.zoop.ws now only serves client-side tokenization.
// See https://docs.zoop.co/docs/fazendo-uma-chamada
const SANDBOX_BASE = 'https://payments.zoop.ws';
const PROD_BASE = 'https://payments.zoop.ws';

export interface ZoopAdapterOptions {
  marketplaceId: string;
  /** Publishable Key (ZPK) — goes in Authorization: Basic for mTLS-authenticated calls */
  publishableKey: string;
  /** x-api-key issued by Zoop alongside the mTLS certificate — infra-level rate-limit identification, not a business credential */
  xApiKey: string;
  sandbox?: boolean;
  /** Path to PEM-encoded client certificate file */
  certPath?: string;
  /** Path to client private key file */
  keyPath?: string;
}

export class ZoopPaymentAdapter implements PaymentProvider {
  private readonly logger = new Logger(ZoopPaymentAdapter.name);
  private readonly http: AxiosInstance;

  constructor(private readonly opts: ZoopAdapterOptions) {
    const { marketplaceId: _mid, publishableKey, xApiKey, sandbox = true, certPath, keyPath } = opts;

    let httpsAgent: https.Agent | undefined;
    if (certPath && keyPath) {
      httpsAgent = new https.Agent({
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      });
      this.logger.log('mTLS enabled for Zoop');
    }

    this.http = axios.create({
      baseURL: sandbox ? SANDBOX_BASE : PROD_BASE,
      auth: { username: publishableKey, password: '' },
      headers: { 'x-api-key': xApiKey },
      timeout: 20_000,
      ...(httpsAgent ? { httpsAgent } : {}),
    });
  }

  private get marketplaceId() { return this.opts.marketplaceId; }

  async createCharge(cmd: CreateChargeCmd): Promise<ChargeResult> {
    if (cmd.method === 'pix') return this.createPixCharge(cmd);
    if (cmd.method === 'boleto') return this.createBoletoCharge(cmd);
    return this.createCardCharge(cmd);
  }

  private async createPixCharge(cmd: CreateChargeCmd): Promise<ChargeResult> {
    const payload = {
      on_behalf_of: cmd.sellerId,
      amount: cmd.amount.amount,
      currency: cmd.amount.currency,
      description: cmd.description ?? 'Pagamento',
      reference_id: cmd.referenceId,
      customer: buildCustomer(cmd),
      payment_type: 'pix',
      pix: { expiration_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
    };
    const res = await this.http.post(`/v1/marketplaces/${this.marketplaceId}/transactions`, payload);
    const data = res.data as ZoopTransaction;
    return {
      providerId: data.id,
      status: mapZoopStatus(data.status),
      pixQrCode: data.payment_method?.qr_code,
      pixQrCodeUrl: data.payment_method?.qr_code_url,
      pixExpiresAt: data.payment_method?.expiration_date ? new Date(data.payment_method.expiration_date) : undefined,
      raw: data,
    };
  }

  private async createBoletoCharge(cmd: CreateChargeCmd): Promise<ChargeResult> {
    const payload = {
      on_behalf_of: cmd.sellerId,
      amount: cmd.amount.amount,
      currency: cmd.amount.currency,
      description: cmd.description ?? 'Pagamento',
      reference_id: cmd.referenceId,
      customer: buildCustomer(cmd),
      payment_type: 'boleto',
    };
    const res = await this.http.post(`/v1/marketplaces/${this.marketplaceId}/transactions`, payload);
    const data = res.data as ZoopTransaction;
    return {
      providerId: data.id,
      status: 'waiting_payment',
      boletoUrl: data.payment_method?.url,
      boletoBarcode: data.payment_method?.barcode,
      boletoExpiresAt: data.payment_method?.expiration_date ? new Date(data.payment_method.expiration_date) : undefined,
      raw: data,
    };
  }

  private async createCardCharge(cmd: CreateChargeCmd): Promise<ChargeResult> {
    const payload = {
      on_behalf_of: cmd.sellerId,
      amount: cmd.amount.amount,
      currency: cmd.amount.currency,
      description: cmd.description ?? 'Pagamento',
      reference_id: cmd.referenceId,
      payment_type: 'credit',
      source: { token_id: cmd.token, usage: 'single_use' },
      capture: cmd.capture !== false,
      installment_plan: cmd.installments && cmd.installments > 1
        ? { mode: 'with_interest', number_installments: cmd.installments }
        : undefined,
    };
    const res = await this.http.post(`/v1/marketplaces/${this.marketplaceId}/transactions`, payload);
    const data = res.data as ZoopTransaction;
    return { providerId: data.id, status: mapZoopStatus(data.status), raw: data };
  }

  async capture(chargeId: string, amount?: Money): Promise<ChargeResult> {
    const payload = amount ? { amount: amount.amount } : {};
    const res = await this.http.post(`/v1/marketplaces/${this.marketplaceId}/transactions/${chargeId}/capture`, payload);
    const data = res.data as ZoopTransaction;
    return { providerId: data.id, status: mapZoopStatus(data.status), raw: data };
  }

  async void(chargeId: string): Promise<void> {
    await this.http.post(`/v1/marketplaces/${this.marketplaceId}/transactions/${chargeId}/void`);
  }

  async refund(chargeId: string, amount?: Money): Promise<RefundResult> {
    const payload = amount ? { amount: amount.amount } : {};
    const res = await this.http.post(`/v1/marketplaces/${this.marketplaceId}/transactions/${chargeId}/refund`, payload);
    const data = res.data as { id: string; status: string };
    return { refundId: data.id, status: 'refunded', raw: data };
  }

  async getCharge(chargeId: string): Promise<ChargeResult> {
    const res = await this.http.get(`/v1/marketplaces/${this.marketplaceId}/transactions/${chargeId}`);
    const data = res.data as ZoopTransaction;
    return { providerId: data.id, status: mapZoopStatus(data.status), raw: data };
  }

  /** Fetches a seller's record, or null if it doesn't exist on this marketplace. */
  async getSeller(sellerId: string): Promise<ZoopSeller | null> {
    try {
      const res = await this.http.get(`/v1/marketplaces/${this.marketplaceId}/sellers/${sellerId}`);
      return res.data as ZoopSeller;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null;
      throw err;
    }
  }

  /** Checks that a seller ID exists on this marketplace — used to validate zoop_seller_id
   * before it's saved, since Zoop only reports a bad value at charge time otherwise. */
  async verifySeller(sellerId: string): Promise<boolean> {
    return (await this.getSeller(sellerId)) !== null;
  }
}

export interface ZoopSeller {
  id: string;
  status: string;
  type: 'individual' | 'business' | string;
  business_name?: string;
  first_name?: string;
  last_name?: string;
  statement_descriptor?: string;
  [key: string]: unknown;
}

function buildCustomer(cmd: CreateChargeCmd): Record<string, unknown> {
  return {
    name: cmd.customer.name,
    taxpayer_id: cmd.customer.document,
    email: cmd.customer.email,
    phone_number: cmd.customer.phone,
    address: cmd.customer.address ? {
      line1: cmd.customer.address.line1,
      line2: cmd.customer.address.line2,
      city: cmd.customer.address.city,
      state: cmd.customer.address.state,
      postal_code: cmd.customer.address.postal_code,
      country_code: cmd.customer.address.country,
    } : undefined,
  };
}

type ZoopTxStatus = 'pending' | 'pre_authorized' | 'succeeded' | 'failed' | 'reversed' | 'charged_back' | string;

function mapZoopStatus(status: ZoopTxStatus): ChargeResult['status'] {
  switch (status) {
    case 'pre_authorized': return 'authorized';
    case 'succeeded': return 'captured';
    case 'pending': return 'waiting_payment';
    case 'failed': return 'failed';
    case 'reversed': return 'reversed';
    default: return 'unknown';
  }
}

interface ZoopTransaction {
  id: string;
  status: ZoopTxStatus;
  payment_method?: {
    qr_code?: string;
    qr_code_url?: string;
    expiration_date?: string;
    url?: string;
    barcode?: string;
  };
  [key: string]: unknown;
}
