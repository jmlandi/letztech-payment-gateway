import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PaymentsService } from '../payments/payments.service';
import { StoresService } from '../stores/stores.service';
import { RiskService } from '../risk/risk.service';
import { ProvidersService } from '../providers/providers.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PaymentStatus } from '../domain/state-machine/allowed-transitions';
import { CreateChargeCmd } from '../domain/interfaces/payment-provider.interface';

export interface WooCommercePaymentPayload {
  sellerId: string;
  orderId: string;
  method: 'pix' | 'boleto' | 'credit_card';
  amount: number; // reais, decimal
  description?: string;
  installments?: number;
  customer: {
    name: string;
    document: string;
    email: string;
    phone?: string;
    address?: {
      line1: string;
      line2?: string;
      city: string;
      state: string;
      postal_code: string;
      country?: string;
    };
  };
  source?: {
    tokenId: string;
  };
}

export interface WooCommercePaymentResponse {
  idTransacao?: string;
  status?: string;
  emv?: string;
  qrCodeUrl?: string;
  barcode?: string;
  url?: string;
  expiration_date?: string;
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
    if (payload.method === 'credit_card' && !payload.source?.tokenId) {
      throw new BadRequestException({ error: { code: 'missing_token', message: 'source.tokenId is required for credit_card' } });
    }
    if (payload.method === 'boleto' && !payload.customer.address) {
      throw new BadRequestException({ error: { code: 'missing_address', message: 'customer.address is required for boleto' } });
    }

    const { store, settings } = await this.storesService.getOrCreateBySellerId(payload.sellerId);

    const idempotencyKey = `wc-${payload.sellerId}-${payload.orderId}`;
    const requestHash = createHash('sha256').update(rawBody).digest('hex');

    const { existing, record } = await this.idempotencyService.getOrCreate(store.id, idempotencyKey, requestHash);
    if (existing && record.response) {
      return record.response as unknown as WooCommercePaymentResponse;
    }

    const amountInCents = Math.round(payload.amount * 100);
    const customer: CreateChargeCmd['customer'] = {
      ...payload.customer,
      address: payload.customer.address ? { ...payload.customer.address, country: payload.customer.address.country ?? 'BR' } : undefined,
    };

    const payment = await this.paymentsService.create({
      storeId: store.id,
      externalRef: idempotencyKey,
      method: payload.method,
      amount: amountInCents,
      customer,
      items: [],
      idempotencyKey,
    });

    const fraudVerdict = await this.riskService.evaluate(settings, {
      referenceId: payment.id,
      orderId: payload.orderId,
      amount: amountInCents,
      currency: 'BRL',
      customer,
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
      method: payload.method,
      amount: { amount: amountInCents, currency: 'BRL' },
      token: payload.source?.tokenId,
      installments: payload.installments,
      capture: true,
      customer,
      description: payload.description,
    });

    await this.paymentsService.saveProviderCharge({
      paymentId: payment.id,
      storeId: store.id,
      provider: 'zoop',
      providerId: chargeResult.providerId,
      type: payload.method === 'credit_card' ? 'authorization' : 'charge',
      status: chargeResult.status,
      amount: amountInCents,
      raw: chargeResult.raw,
    });

    let response: WooCommercePaymentResponse;
    if (chargeResult.status === 'failed') {
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.REFUSED, 'zoop', chargeResult.raw);
      response = { error: { message: 'Pagamento não autorizado' } };
    } else if (payload.method === 'pix' && chargeResult.pixQrCode) {
      await this.paymentsService.updatePaymentPixData(payment.id, store.id, {
        pixQrCode: chargeResult.pixQrCode,
        pixQrCodeUrl: chargeResult.pixQrCodeUrl ?? '',
        pixExpiresAt: chargeResult.pixExpiresAt ?? new Date(Date.now() + 86400000),
      });
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.WAITING_PAYMENT, 'zoop', chargeResult.raw);
      response = {
        idTransacao: payment.id,
        status: chargeResult.status,
        emv: chargeResult.pixQrCode,
        qrCodeUrl: chargeResult.pixQrCodeUrl,
        expiration_date: chargeResult.pixExpiresAt?.toISOString(),
      };
    } else if (payload.method === 'boleto' && chargeResult.boletoUrl) {
      await this.paymentsService.updatePaymentBoletoData(payment.id, store.id, {
        boletoUrl: chargeResult.boletoUrl,
        boletoBarcode: chargeResult.boletoBarcode ?? '',
        boletoExpiresAt: chargeResult.boletoExpiresAt ?? new Date(Date.now() + 3 * 86400000),
      });
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.WAITING_PAYMENT, 'zoop', chargeResult.raw);
      response = {
        idTransacao: payment.id,
        status: chargeResult.status,
        barcode: chargeResult.boletoBarcode,
        url: chargeResult.boletoUrl,
        expiration_date: chargeResult.boletoExpiresAt?.toISOString(),
      };
    } else {
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.AUTHORIZED, 'zoop', chargeResult.raw);
      response = { idTransacao: payment.id, status: chargeResult.status };
    }

    await this.idempotencyService.saveResponse(record.id, response as unknown as Record<string, unknown>);
    return response;
  }
}
