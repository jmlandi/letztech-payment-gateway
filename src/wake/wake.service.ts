import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from '../payments/payments.service';
import { StoresService } from '../stores/stores.service';
import { RiskService } from '../risk/risk.service';
import { ProvidersService } from '../providers/providers.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PaymentStatus } from '../domain/state-machine/allowed-transitions';
import { createHash } from 'crypto';

// Raw Wake payload shapes (simplified — real payloads follow wakecommerce.readme.io)
export interface WakePaymentPayload {
  pedido: string;
  id: string;
  chave: string;
  carrinhoId?: string;
  identificador?: string;
  pagamento: {
    valor: number;
    parcelas?: number;
    cartao?: {
      token: string;
      bandeira?: string;
    };
    fraudId?: string;
    metodoPagamento?: string;
    pix?: boolean;
    boleto?: boolean;
  };
  usuario: {
    nome: string;
    cpf?: string;
    cnpj?: string;
    email: string;
    telefone?: string;
    ip?: string;
    endereco?: {
      logradouro: string;
      cidade: string;
      estado: string;
      cep: string;
      pais?: string;
    };
  };
  produtos?: Array<{
    sku: string;
    nome: string;
    quantidade: number;
    precoUnitario: number;
  }>;
  frete?: number;
}

export interface WakePaymentResponse {
  statusId: number;
  mensagem?: string;
  transacao?: string;
  pix?: { qrCode: string; qrCodeUrl: string; expiresAt: string };
  boleto?: { url: string; barcode: string; expiresAt: string };
}

@Injectable()
export class WakeService {
  private readonly logger = new Logger(WakeService.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly storesService: StoresService,
    private readonly riskService: RiskService,
    private readonly providersService: ProvidersService,
    private readonly idempotencyService: IdempotencyService,
    private readonly config: ConfigService,
  ) {}

  async handlePayment(
    wakeStoreHeader: string,
    apiKey: string,
    payload: WakePaymentPayload,
    rawBody: string,
  ): Promise<WakePaymentResponse> {
    const { store, settings } = await this.storesService.resolveByWakeHeaders(wakeStoreHeader, apiKey);

    const idempotencyKey = `${payload.pedido}-${payload.id}`;
    const requestHash = createHash('sha256').update(rawBody).digest('hex');

    const { existing, record } = await this.idempotencyService.getOrCreate(
      store.id,
      idempotencyKey,
      requestHash,
    );

    if (existing && record.response) {
      return record.response as unknown as WakePaymentResponse;
    }

    const method = resolveMethod(payload);
    const customer = buildCustomer(payload);
    const items = buildItems(payload);

    const payment = await this.paymentsService.create({
      storeId: store.id,
      externalRef: idempotencyKey,
      method,
      amount: Math.round(payload.pagamento.valor * 100),
      customer,
      items,
      fraudFingerprintId: payload.pagamento.fraudId,
      idempotencyKey,
      wakeOrderId: payload.pedido,
    });

    const fraudCtx = {
      referenceId: payment.id,
      orderId: payload.pedido,
      amount: payment.amount,
      currency: 'BRL',
      fingerprintId: payload.pagamento.fraudId,
      customer: {
        name: payload.usuario.nome,
        document: payload.usuario.cpf ?? payload.usuario.cnpj ?? '',
        email: payload.usuario.email,
        phone: payload.usuario.telefone,
        ip: payload.usuario.ip,
        address: payload.usuario.endereco ? {
          line1: payload.usuario.endereco.logradouro,
          city: payload.usuario.endereco.cidade,
          state: payload.usuario.endereco.estado,
          postal_code: payload.usuario.endereco.cep,
          country: payload.usuario.endereco.pais ?? 'BR',
        } : undefined,
      },
      items: (payload.produtos ?? []).map((p) => ({
        sku: p.sku,
        name: p.nome,
        quantity: p.quantidade,
        unitAmount: Math.round(p.precoUnitario * 100),
      })),
      shippingAmount: payload.frete ? Math.round(payload.frete * 100) : undefined,
      callbackUrl: settings.fraudEnabled
        ? `${this.config.get('BASE_URL') ?? ''}/webhooks/koin`
        : undefined,
    };

    // For card: optional pre-evaluation before authorization
    if (method === 'credit_card' && settings.fraudEnabled && riskService_preEval(this.riskService, settings)) {
      const preVerdict = await this.riskService.preEvaluate(settings, fraudCtx);
      if (preVerdict?.status === 'denied') {
        await this.paymentsService.transition(payment.id, store.id, PaymentStatus.REFUSED, 'koin_pre_eval', preVerdict);
        const response = { statusId: 5, mensagem: 'Pagamento recusado pela análise de risco', transacao: payment.id };
        await this.idempotencyService.saveResponse(record.id, response);
        return response;
      }
    }

    // Fraud evaluation (for pix/boleto: before charge; for card: after pre-auth, handled in flow)
    const fraudVerdict = await this.riskService.evaluate(settings, fraudCtx);

    if (fraudVerdict.status === 'denied') {
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.REFUSED, 'koin_eval', fraudVerdict);
      const response = { statusId: 5, mensagem: 'Pagamento recusado pela análise de risco', transacao: payment.id };
      await this.idempotencyService.saveResponse(record.id, response);
      return response;
    }

    if (fraudVerdict.status === 'received') {
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.UNDER_REVIEW, 'koin_eval', fraudVerdict);
      const response = { statusId: 7, mensagem: 'Pagamento em análise', transacao: payment.id };
      await this.idempotencyService.saveResponse(record.id, response);
      return response;
    }

    await this.paymentsService.transition(payment.id, store.id, PaymentStatus.APPROVED_RISK, 'koin_eval', fraudVerdict);

    const provider = this.providersService.getPaymentProvider(settings);
    const chargeResult = await provider.createCharge({
      referenceId: payment.id,
      sellerId: settings.zoopSellerId ?? '',
      method: method as 'pix' | 'boleto' | 'credit_card',
      amount: { amount: payment.amount, currency: 'BRL' },
      token: payload.pagamento.cartao?.token,
      installments: payload.pagamento.parcelas,
      capture: method !== 'credit_card',
      customer: {
        name: payload.usuario.nome,
        document: payload.usuario.cpf ?? payload.usuario.cnpj ?? '',
        email: payload.usuario.email,
        phone: payload.usuario.telefone,
      },
    });

    await this.paymentsService.saveProviderCharge({
      paymentId: payment.id,
      storeId: store.id,
      provider: 'zoop',
      providerId: chargeResult.providerId,
      type: method === 'credit_card' ? 'authorization' : 'charge',
      status: chargeResult.status,
      amount: payment.amount,
      raw: chargeResult.raw,
    });

    let response: WakePaymentResponse;

    if (chargeResult.status === 'failed') {
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.REFUSED, 'zoop', chargeResult.raw);
      response = { statusId: 2, mensagem: 'Pagamento não autorizado', transacao: payment.id };
    } else if (method === 'pix' && chargeResult.pixQrCode) {
      await this.paymentsService.updatePaymentPixData(payment.id, store.id, {
        pixQrCode: chargeResult.pixQrCode,
        pixQrCodeUrl: chargeResult.pixQrCodeUrl ?? '',
        pixExpiresAt: chargeResult.pixExpiresAt ?? new Date(Date.now() + 86400000),
      });
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.WAITING_PAYMENT, 'zoop', chargeResult.raw);
      response = {
        statusId: 7,
        transacao: payment.id,
        pix: { qrCode: chargeResult.pixQrCode, qrCodeUrl: chargeResult.pixQrCodeUrl ?? '', expiresAt: (chargeResult.pixExpiresAt ?? new Date()).toISOString() },
      };
    } else if (method === 'boleto' && chargeResult.boletoUrl) {
      await this.paymentsService.updatePaymentBoletoData(payment.id, store.id, {
        boletoUrl: chargeResult.boletoUrl,
        boletoBarcode: chargeResult.boletoBarcode ?? '',
        boletoExpiresAt: chargeResult.boletoExpiresAt ?? new Date(Date.now() + 3 * 86400000),
      });
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.WAITING_PAYMENT, 'zoop', chargeResult.raw);
      response = {
        statusId: 7,
        transacao: payment.id,
        boleto: { url: chargeResult.boletoUrl, barcode: chargeResult.boletoBarcode ?? '', expiresAt: (chargeResult.boletoExpiresAt ?? new Date()).toISOString() },
      };
    } else {
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.AUTHORIZED, 'zoop', chargeResult.raw);
      response = { statusId: 1, transacao: payment.id };
    }

    await this.idempotencyService.saveResponse(record.id, response as unknown as Record<string, unknown>);
    return response;
  }

  async handleCapture(wakeStoreHeader: string, apiKey: string, payload: { transacao: string; valor?: number }): Promise<WakePaymentResponse> {
    const { store, settings } = await this.storesService.resolveByWakeHeaders(wakeStoreHeader, apiKey);
    const payment = await this.paymentsService.findById(payload.transacao, store.id);
    const provider = this.providersService.getPaymentProvider(settings);

    const lastCharge = payment.providerCharges?.at(-1);
    if (!lastCharge?.providerId) throw new Error('No charge found to capture');

    const amount = payload.valor ? { amount: Math.round(payload.valor * 100), currency: 'BRL' } : undefined;
    await provider.capture(lastCharge.providerId, amount);
    await this.paymentsService.transition(payment.id, store.id, PaymentStatus.CAPTURED, 'wake_capture');
    return { statusId: 1, transacao: payment.id };
  }

  async handleCancel(wakeStoreHeader: string, apiKey: string, payload: { transacao: string; valor?: number }): Promise<WakePaymentResponse> {
    const { store, settings } = await this.storesService.resolveByWakeHeaders(wakeStoreHeader, apiKey);
    const payment = await this.paymentsService.findById(payload.transacao, store.id);
    const provider = this.providersService.getPaymentProvider(settings);
    const lastCharge = payment.providerCharges?.at(-1);

    if (!lastCharge?.providerId) throw new Error('No charge found to cancel');

    if (payment.status === PaymentStatus.AUTHORIZED) {
      await provider.void(lastCharge.providerId);
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.CANCELLED, 'wake_cancel');
    } else {
      const amount = payload.valor ? { amount: Math.round(payload.valor * 100), currency: 'BRL' } : undefined;
      await provider.refund(lastCharge.providerId, amount);
      await this.paymentsService.transition(payment.id, store.id, PaymentStatus.REFUNDED, 'wake_cancel');
    }

    return { statusId: 1, transacao: payment.id };
  }

  async handleChargeback(wakeStoreHeader: string, apiKey: string, payload: { transacao: string }): Promise<{ ok: boolean }> {
    const { store } = await this.storesService.resolveByWakeHeaders(wakeStoreHeader, apiKey);
    await this.paymentsService.transition(payload.transacao, store.id, PaymentStatus.CHARGEBACK, 'wake_chargeback');
    return { ok: true };
  }
}

function resolveMethod(payload: WakePaymentPayload): string {
  if (payload.pagamento.pix) return 'pix';
  if (payload.pagamento.boleto) return 'boleto';
  return 'credit_card';
}

function buildCustomer(payload: WakePaymentPayload): Record<string, unknown> {
  return {
    name: payload.usuario.nome,
    document: payload.usuario.cpf ?? payload.usuario.cnpj,
    email: payload.usuario.email,
    phone: payload.usuario.telefone,
    ip: payload.usuario.ip,
    address: payload.usuario.endereco,
  };
}

function buildItems(payload: WakePaymentPayload): unknown[] {
  return (payload.produtos ?? []).map((p) => ({
    sku: p.sku,
    name: p.nome,
    quantity: p.quantidade,
    unit_amount: Math.round(p.precoUnitario * 100),
  }));
}

function riskService_preEval(riskService: RiskService, settings: Parameters<RiskService['preEvaluate']>[0]): boolean {
  return settings.fraudEnabled && !!settings.koinPrivateKeyEncrypted;
}
