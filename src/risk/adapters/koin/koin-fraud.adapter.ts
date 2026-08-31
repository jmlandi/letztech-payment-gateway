import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { FraudContext, FraudOutcomeNotification, FraudProvider, FraudVerdict } from '../../../domain/interfaces/fraud-provider.interface';

const SANDBOX_BASE = 'https://api-sandbox.koin.com.br/v1';
const PROD_BASE = 'https://api.koin.com.br/v1';

// Koin has no dedicated Boleto value; Asynchronous is the closest documented
// method for an offline/delayed settlement instrument.
const PAYMENT_METHOD_MAP: Record<string, string> = {
  credit_card: 'CreditCard',
  pix: 'Pix',
  boleto: 'Asynchronous',
};

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

  /** `referenceId` here is our own reference_id (payment.id), not Koin's evaluation_id. */
  async checkStatus(referenceId: string): Promise<FraudVerdict> {
    const res = await this.http.get(`/antifraud/evaluations/${referenceId}`, { params: { field: 'REFERENCE_ID' } });
    return mapVerdict(res.data);
  }

  async notifyOutcome(referenceId: string, notification: FraudOutcomeNotification): Promise<void> {
    const body = buildNotificationPayload(notification);
    await this.http
      .patch(`/antifraud/notifications/${referenceId}`, body, { params: { field: 'REFERENCE_ID' } })
      .catch((err: unknown) => {
        this.logger.warn({ referenceId, notification, err }, 'Koin outcome notification failed (non-critical)');
      });
  }
}

const CANCEL_REASON_MAP: Record<Extract<FraudOutcomeNotification, { kind: 'cancelled' }>['reason'], string> = {
  requested_by_customer: 'REQUESTED_BY_CUSTOMER',
  collect_error: 'COLLECT_ERROR',
  requested_by_commerce: 'REQUESTED_BY_COMMERCE',
};

function buildNotificationPayload(notification: FraudOutcomeNotification): Record<string, unknown> {
  const notification_date = new Date().toISOString();
  switch (notification.kind) {
    case 'collected':
      return {
        type: 'STATUS',
        sub_type: 'COLLECTED',
        authorization_code: notification.authorizationCode,
        payment_id: notification.paymentId,
        notification_date,
      };
    case 'not_collected':
      return { type: 'STATUS', sub_type: 'NOT_COLLECTED', message: notification.message, notification_date };
    case 'finalized':
      return { type: 'STATUS', sub_type: 'FINALIZED', notification_date };
    case 'cancelled':
      return { type: 'STATUS', sub_type: 'CANCELLED', reason: CANCEL_REASON_MAP[notification.reason], notification_date };
    case 'refunded':
      return {
        type: 'REFUND',
        full: notification.full,
        amount: notification.amountCents !== undefined ? toMajorUnit(notification.amountCents) : undefined,
        notification_date,
      };
  }
}

/** Koin's `value` fields are decimal amounts in the currency's major unit (reais), not cents. */
function toMajorUnit(cents: number): number {
  return Math.round(cents) / 100;
}

function money(currency: string, cents: number): { currency: string; value: number } {
  return { currency, value: toMajorUnit(cents) };
}

function documentType(document: string): 'CPF' | 'CNPJ' {
  return document.replace(/\D/g, '').length > 11 ? 'CNPJ' : 'CPF';
}

function buildKoinPayload(ctx: FraudContext): Record<string, unknown> {
  return {
    type: 'Ecommerce',
    buyer: {
      full_name: ctx.customer.name,
      email: ctx.customer.email,
      document: {
        type: documentType(ctx.customer.document),
        number: ctx.customer.document,
      },
      phone: ctx.customer.phone ? { number: ctx.customer.phone } : undefined,
      address: ctx.customer.address
        ? {
            street: ctx.customer.address.line1,
            city: ctx.customer.address.city,
            state: ctx.customer.address.state,
            zip_code: ctx.customer.address.postal_code,
            country_code: ctx.customer.address.country ?? 'BR',
          }
        : undefined,
    },
    device: ctx.customer.ip ? { ipv4: ctx.customer.ip, session_id: ctx.fingerprintId } : undefined,
    store: ctx.storeCode ? { code: ctx.storeCode } : undefined,
    items: ctx.items.map((i) => ({
      type: 'Generic',
      id: i.sku,
      name: i.name,
      price: money(ctx.currency, i.unitAmount),
      quantity: i.quantity,
    })),
    payments: [
      {
        method: PAYMENT_METHOD_MAP[ctx.method] ?? 'CreditCard',
        amount: money(ctx.currency, ctx.amount),
        installments: ctx.method === 'credit_card' ? (ctx.installments ?? 1) : undefined,
        details: ctx.card?.brand ? { brand_name: ctx.card.brand } : undefined,
      },
    ],
    shipping: ctx.shippingAmount ? { price: money(ctx.currency, ctx.shippingAmount) } : undefined,
    transaction: {
      reference_id: ctx.referenceId,
      country_code: 'BR',
      total_amount: money(ctx.currency, ctx.amount),
    },
    callback_url: ctx.callbackUrl,
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
