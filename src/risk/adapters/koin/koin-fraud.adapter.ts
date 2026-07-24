import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { FraudContext, FraudProvider, FraudVerdict, TxOutcome } from '../../../domain/interfaces/fraud-provider.interface';

const SANDBOX_BASE = 'https://api-sandbox.koin.com.br/v1';
const PROD_BASE = 'https://api.koin.com.br/v1';

export class KoinFraudAdapter implements FraudProvider {
  private readonly logger = new Logger(KoinFraudAdapter.name);
  private readonly http: AxiosInstance;

  constructor(private readonly privateKey: string, sandbox = true) {
    this.http = axios.create({
      baseURL: sandbox ? SANDBOX_BASE : PROD_BASE,
      headers: { Authorization: `Bearer ${privateKey}`, 'Content-Type': 'application/json' },
      timeout: 30_000,
    });
  }

  async preEvaluate(ctx: FraudContext): Promise<FraudVerdict> {
    const payload = buildKoinPayload(ctx);
    const res = await this.http.post('/antifraud/pre-evaluations', payload);
    return mapVerdict(res.data);
  }

  async evaluate(ctx: FraudContext): Promise<FraudVerdict> {
    const payload = buildKoinPayload(ctx);
    const res = await this.http.post('/antifraud/evaluations', payload);
    return mapVerdict(res.data);
  }

  async checkStatus(referenceId: string): Promise<FraudVerdict> {
    const res = await this.http.get(`/antifraud/evaluations/${referenceId}`);
    return mapVerdict(res.data);
  }

  async notifyOutcome(referenceId: string, outcome: TxOutcome): Promise<void> {
    await this.http.patch(`/antifraud/notifications/${referenceId}`, { outcome }).catch((err: unknown) => {
      this.logger.warn({ referenceId, outcome, err }, 'Koin outcome notification failed (non-critical)');
    });
  }
}

function buildKoinPayload(ctx: FraudContext): Record<string, unknown> {
  return {
    reference_id: ctx.referenceId,
    order_id: ctx.orderId,
    amount: ctx.amount,
    currency: ctx.currency,
    fingerprint_id: ctx.fingerprintId,
    callback_url: ctx.callbackUrl,
    customer: {
      name: ctx.customer.name,
      document: ctx.customer.document,
      email: ctx.customer.email,
      phone: ctx.customer.phone,
      ip: ctx.customer.ip,
      address: ctx.customer.address,
    },
    items: ctx.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unit_amount: i.unitAmount,
    })),
    shipping_amount: ctx.shippingAmount,
  };
}

type KoinStatus = 'approved' | 'denied' | 'received' | string;

function mapVerdict(data: { status?: KoinStatus; score?: number; id?: string; [key: string]: unknown }): FraudVerdict {
  const status = (data.status as KoinStatus | undefined) === 'approved'
    ? 'approved'
    : data.status === 'denied'
      ? 'denied'
      : 'received';
  return { status, score: data.score ?? 50, evaluationId: data.id, raw: data };
}
