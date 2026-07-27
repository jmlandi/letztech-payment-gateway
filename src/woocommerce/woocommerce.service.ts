import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PaymentsService } from '../payments/payments.service';
import { StoresService } from '../stores/stores.service';
import { RiskService } from '../risk/risk.service';
import { ProvidersService } from '../providers/providers.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PaymentStatus } from '../domain/state-machine/allowed-transitions';

export interface WooCommercePaymentPayload {
  sellerId: string;
  orderId: string;
  amount: number; // reais, decimal
  description?: string;
  installments?: number;
  customer: {
    name: string;
    document: string;
    email: string;
    phone?: string;
  };
  source: {
    tokenId: string;
  };
}

export interface WooCommercePaymentResponse {
  idTransacao?: string;
  status?: string;
  error?: { message: string };
}

@Injectable()
export class WooCommerceService {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly storesService: StoresService,
    private readonly riskService: RiskService,
    private readonly providersService: ProvidersService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async handlePayment(payload: WooCommercePaymentPayload, rawBody: string): Promise<WooCommercePaymentResponse> {
    const { store, settings } = await this.storesService.getOrCreateBySellerId(payload.sellerId);

    const idempotencyKey = `wc-${payload.sellerId}-${payload.orderId}`;
    const requestHash = createHash('sha256').update(rawBody).digest('hex');

    const { existing, record } = await this.idempotencyService.getOrCreate(store.id, idempotencyKey, requestHash);
    if (existing && record.response) {
      return record.response as unknown as WooCommercePaymentResponse;
    }

    const amountInCents = Math.round(payload.amount * 100);

    const payment = await this.paymentsService.create({
      storeId: store.id,
      externalRef: idempotencyKey,
      method: 'credit_card',
      amount: amountInCents,
      customer: payload.customer,
      items: [],
      idempotencyKey,
    });

    const fraudVerdict = await this.riskService.evaluate(settings, {
      referenceId: payment.id,
      orderId: payload.orderId,
      amount: amountInCents,
      currency: 'BRL',
      customer: payload.customer,
      items: [],
    });

    if (fraudVerdict.status === 'denied') {
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.REFUSED, 'koin_eval', fraudVerdict);
      const response = { error: { message: 'Pagamento recusado pela análise de risco' } };
      await this.idempotencyService.saveResponse(record.id, response);
      return response;
    }

    if (fraudVerdict.status === 'received') {
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.UNDER_REVIEW, 'koin_eval', fraudVerdict);
      const response = { idTransacao: payment.id, status: 'under_review' };
      await this.idempotencyService.saveResponse(record.id, response);
      return response;
    }

    await this.paymentsService.transition(payment.id, store.id, PaymentStatus.APPROVED_RISK, 'koin_eval', fraudVerdict);

    const provider = this.providersService.getPaymentProvider(settings);
    const chargeResult = await provider.createCharge({
      referenceId: payment.id,
      sellerId: settings.zoopSellerId ?? payload.sellerId,
      method: 'credit_card',
      amount: { amount: amountInCents, currency: 'BRL' },
      token: payload.source.tokenId,
      installments: payload.installments,
      capture: true,
      customer: payload.customer,
      description: payload.description,
    });

    await this.paymentsService.saveProviderCharge({
      paymentId: payment.id,
      storeId: store.id,
      provider: 'zoop',
      providerId: chargeResult.providerId,
      type: 'authorization',
      status: chargeResult.status,
      amount: amountInCents,
      raw: chargeResult.raw,
    });

    let response: WooCommercePaymentResponse;
    if (chargeResult.status === 'failed') {
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.REFUSED, 'zoop', chargeResult.raw);
      response = { error: { message: 'Pagamento não autorizado' } };
    } else {
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.AUTHORIZED, 'zoop', chargeResult.raw);
      response = { idTransacao: payment.id, status: chargeResult.status };
    }

    await this.idempotencyService.saveResponse(record.id, response as unknown as Record<string, unknown>);
    return response;
  }
}
