import * as fs from 'fs';
import * as https from 'https';
import { Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import {
  ChargeResult,
  CreateChargeCmd,
  Money,
  PaymentProvider,
  RefundResult,
} from '../../domain/interfaces/payment-provider.interface';
import { getTraceId } from '../../common/context/request-context';
import { normalizeZoopPath, redactDeep, tokenFingerprint } from '../../common/utils/redact';

declare module 'axios' {
  // Per-call annotations read back by the logging interceptors below.
  export interface AxiosRequestConfig {
    metadata?: {
      operation?: string;
      /** Our payment id — the same value Zoop stores as reference_id. */
      referenceId?: string;
      traceId?: string;
      startedAt?: bigint;
      /** Last 4 chars of the card token — correlates retries, can't be charged with. */
      tokenFp?: string | null;
      /** A 404 is a valid answer for this call, not a failure worth warning about. */
      expectNotFound?: boolean;
    };
  }
}

function elapsedMs(startedAt: bigint | undefined): number | undefined {
  if (startedAt === undefined) return undefined;
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
}

// Payment/transaction endpoints moved off api.zoop.ws to a dedicated host after
// Zoop's mTLS rollout; api.zoop.ws now only serves client-side tokenization.
// Sandbox and production charges both go through this same host — Zoop
// distinguishes the two by which publishable key/marketplace/cert you send,
// not by URL. See https://docs.zoop.co/docs/fazendo-uma-chamada
const BASE_URL = 'https://payments.zoop.ws';

export interface ZoopAdapterOptions {
  marketplaceId: string;
  /** Publishable Key (ZPK) — goes in Authorization: Basic for mTLS-authenticated calls */
  publishableKey: string;
  /** x-api-key issued by Zoop alongside the mTLS certificate — infra-level rate-limit identification, not a business credential */
  xApiKey: string;
  /** Informational only — tags log lines so sandbox and prod traffic can be told apart. Does not change which host is called; see BASE_URL. */
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
    const { marketplaceId: _mid, publishableKey, xApiKey, certPath, keyPath } = opts;

    let httpsAgent: https.Agent | undefined;
    if (certPath && keyPath) {
      httpsAgent = new https.Agent({
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      });
      this.logger.log('mTLS enabled for Zoop');
    }

    this.http = axios.create({
      baseURL: BASE_URL,
      auth: { username: publishableKey, password: '' },
      headers: { 'x-api-key': xApiKey },
      timeout: 20_000,
      ...(httpsAgent ? { httpsAgent } : {}),
    });

    this.installLogging();
  }

  /**
   * Logs every call to Zoop — attempt, outcome and latency — on the shared
   * axios instance, so each operation is covered without per-method wiring.
   *
   * Nothing derived from `config.headers`, `config.auth` or `config.httpsAgent`
   * is ever logged: those hold the ZPK, the x-api-key and the raw mTLS
   * cert/key material (the same reason `sanitizeException` in the global
   * exception filter refuses to log an Axios error's `.config`). Payloads and
   * remote bodies go through `redactDeep` before they reach the logger.
   */
  private installLogging(): void {
    this.http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      config.metadata = {
        ...config.metadata,
        traceId: getTraceId(),
        startedAt: process.hrtime.bigint(),
      };
      this.logger.log(
        {
          traceId: config.metadata.traceId,
          provider: 'zoop',
          operation: config.metadata.operation,
          referenceId: config.metadata.referenceId,
          method: config.method?.toUpperCase(),
          path: normalizeZoopPath(config.url),
          sandbox: this.opts.sandbox !== false,
          tokenFp: config.metadata.tokenFp,
          request: redactDeep(config.data),
        },
        'Zoop request sent',
      );
      return config;
    });

    this.http.interceptors.response.use(
      (response) => {
        const meta = response.config.metadata;
        const data = response.data as Partial<ZoopTransaction> | undefined;
        this.logger.log(
          {
            traceId: meta?.traceId,
            provider: 'zoop',
            operation: meta?.operation,
            referenceId: meta?.referenceId,
            method: response.config.method?.toUpperCase(),
            path: normalizeZoopPath(response.config.url),
            status: response.status,
            durationMs: elapsedMs(meta?.startedAt),
            providerId: data?.id,
            providerStatus: data?.status,
          },
          'Zoop response received',
        );
        return response;
      },
      (error: unknown) => {
        const err = error as AxiosError;
        const meta = err.config?.metadata;
        const payload = {
          traceId: meta?.traceId,
          provider: 'zoop',
          operation: meta?.operation,
          referenceId: meta?.referenceId,
          method: err.config?.method?.toUpperCase(),
          path: normalizeZoopPath(err.config?.url),
          status: err.response?.status,
          durationMs: elapsedMs(meta?.startedAt),
          // `code` distinguishes a refusal from an unreachable/slow Zoop
          // (ECONNABORTED on timeout, ECONNREFUSED, ETIMEDOUT).
          code: err.code,
          message: err.message,
          response: redactDeep(err.response?.data),
        };
        // A 4xx is Zoop refusing a call (bad seller, declined card); a 5xx,
        // timeout or transport failure is Zoop being unavailable to us.
        const status = err.response?.status;
        if (status === 404 && meta?.expectNotFound) {
          this.logger.log(payload, 'Zoop resource not found');
        } else if (status && status < 500) {
          this.logger.warn(payload, 'Zoop call refused');
        } else {
          this.logger.error(payload, 'Zoop call failed');
        }
        return Promise.reject(error);
      },
    );
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
    const res = await this.http.post(`/v1/marketplaces/${this.marketplaceId}/transactions`, payload, {
      metadata: { operation: 'createCharge.pix', referenceId: cmd.referenceId },
    });
    const data = res.data as ZoopTransaction;
    return {
      providerId: data.id,
      status: mapZoopStatus(data.status),
      pixQrCode: data.payment_method?.qr_code?.emv,
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
      boleto: { expiration_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() },
    };
    const res = await this.http.post(`/v1/marketplaces/${this.marketplaceId}/transactions`, payload, {
      metadata: { operation: 'createCharge.boleto', referenceId: cmd.referenceId },
    });
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
      source: { type: 'card', token_id: cmd.token, usage: 'single_use', currency: cmd.amount.currency },
      capture: cmd.capture !== false,
      installment_plan: cmd.installments && cmd.installments > 1
        ? { mode: 'with_interest', number_installments: cmd.installments }
        : undefined,
    };
    const res = await this.http.post(`/v1/marketplaces/${this.marketplaceId}/transactions`, payload, {
      metadata: {
        operation: 'createCharge.credit_card',
        referenceId: cmd.referenceId,
        tokenFp: tokenFingerprint(cmd.token),
      },
    });
    const data = res.data as ZoopTransaction;
    return { providerId: data.id, status: mapZoopStatus(data.status), raw: data };
  }

  async capture(chargeId: string, amount?: Money): Promise<ChargeResult> {
    const payload = amount ? { amount: amount.amount } : {};
    const res = await this.http.post(`/v1/marketplaces/${this.marketplaceId}/transactions/${chargeId}/capture`, payload, {
      metadata: { operation: 'capture' },
    });
    const data = res.data as ZoopTransaction;
    return { providerId: data.id, status: mapZoopStatus(data.status), raw: data };
  }

  async void(chargeId: string): Promise<void> {
    await this.http.post(`/v1/marketplaces/${this.marketplaceId}/transactions/${chargeId}/void`, undefined, {
      metadata: { operation: 'void' },
    });
  }

  async refund(chargeId: string, amount?: Money): Promise<RefundResult> {
    const payload = amount ? { amount: amount.amount } : {};
    const res = await this.http.post(`/v1/marketplaces/${this.marketplaceId}/transactions/${chargeId}/refund`, payload, {
      metadata: { operation: 'refund' },
    });
    const data = res.data as { id: string; status: string };
    return { refundId: data.id, status: 'refunded', raw: data };
  }

  async getCharge(chargeId: string): Promise<ChargeResult> {
    const res = await this.http.get(`/v1/marketplaces/${this.marketplaceId}/transactions/${chargeId}`, {
      metadata: { operation: 'getCharge' },
    });
    const data = res.data as ZoopTransaction;
    return { providerId: data.id, status: mapZoopStatus(data.status), raw: data };
  }

  /** Fetches a seller's record, or null if it doesn't exist on this marketplace. */
  async getSeller(sellerId: string): Promise<ZoopSeller | null> {
    try {
      const res = await this.http.get(`/v1/marketplaces/${this.marketplaceId}/sellers/${sellerId}`, {
        metadata: { operation: 'getSeller', expectNotFound: true },
      });
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
    qr_code?: { emv?: string };
    qr_code_url?: string;
    expiration_date?: string;
    url?: string;
    barcode?: string;
  };
  [key: string]: unknown;
}
