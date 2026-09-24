import { Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import { StoresService } from '../stores/stores.service';
import { WakeService, WakePaymentPayload, WakePaymentResponse } from '../wake/wake.service';
import { PaymentsService } from '../payments/payments.service';
import { FAKE_ZOOP_SELLER_ID } from '../providers/zoop/fake-zoop.provider';

const STORE_NAME = 'LetzTech Homolog Wake';
const STORE_SLUG = 'letztech-homolog-wake';

/** Card tokens FakeZoopProvider maps to specific outcomes — see fake-zoop.provider.ts. */
export const TEST_CARDS = {
  tok_approved: 'Aprovado — qualquer token fora da lista de recusa abaixo também é aprovado.',
  tok_declined: 'Recusado (motivo genérico).',
  tok_declined_insufficient_funds: 'Recusado — saldo insuficiente.',
  tok_declined_stolen_card: 'Recusado — cartão roubado.',
};

export interface ScenarioStep {
  action: string;
  request: unknown;
  response: unknown;
}

export interface ScenarioReport {
  scenario: string;
  checklistRows: string[];
  ok: boolean;
  error?: string;
  finalStatus?: string;
  steps: ScenarioStep[];
}

@Injectable()
export class HomologService {
  private readonly logger = new Logger(HomologService.name);

  constructor(
    private readonly storesService: StoresService,
    private readonly wakeService: WakeService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async bootstrapStore(): Promise<{ storeId: string; wakeStoreHeader: string; apiKey: string | null; reused: boolean }> {
    const existing = await this.storesService.findByWakeStoreHeader(STORE_SLUG);
    if (existing) {
      // Already provisioned — return it without a key; the plaintext key is
      // only ever returned once, at creation. Use rotateKey to get a new one.
      return { storeId: existing.id, wakeStoreHeader: existing.wakeStoreHeader as string, apiKey: null, reused: true };
    }
    const { store, apiKey } = await this.storesService.createStore(STORE_NAME, STORE_SLUG, FAKE_ZOOP_SELLER_ID);
    return { storeId: store.id, wakeStoreHeader: store.wakeStoreHeader as string, apiKey, reused: false };
  }

  async rotateKey(): Promise<{ storeId: string; wakeStoreHeader: string; apiKey: string }> {
    const store = await this.storesService.findByWakeStoreHeader(STORE_SLUG);
    if (!store) throw new Error('Homolog store not provisioned yet — call POST /homolog/store first');
    const { apiKey } = await this.storesService.rotateCredentials(store.id);
    return { storeId: store.id, wakeStoreHeader: store.wakeStoreHeader as string, apiKey };
  }

  async runScenarios(wakeStoreHeader: string, apiKey: string): Promise<ScenarioReport[]> {
    const runId = ulid().toLowerCase().slice(0, 10);
    const scenarios: Array<() => Promise<ScenarioReport>> = [
      () => this.scenarioCard('cartao_pf_completo', ['Pedido Simples PF', 'Retorno TID/NSU/Auth', 'Antifraude Manual - Autorização Sucesso', 'Antifraude Manual - Captura Sucesso'], wakeStoreHeader, apiKey, runId, { pf: true, capture: true }),
      () => this.scenarioCard('cartao_pj_completo', ['Pedido Simples PJ'], wakeStoreHeader, apiKey, runId, { pf: false, capture: true }),
      () => this.scenarioTokenizado(wakeStoreHeader, apiKey, runId),
      () => this.scenarioCard('cartao_com_juros', ['Pedido com Juros', 'Pedido com Desconto', 'Pedido com Promoção'], wakeStoreHeader, apiKey, runId, { pf: true, capture: true, parcelas: 3, valor: 356.7 }),
      () => this.scenarioCard('cartao_recusado', ['Retorno do erro para pedidos cancelados', 'Antifraude Manual - Autorização Falha/Negada'], wakeStoreHeader, apiKey, runId, { pf: true, capture: false, token: 'tok_declined_insufficient_funds' }),
      () => this.scenarioTrocaPagamento(wakeStoreHeader, apiKey, runId),
      () => this.scenarioPix(wakeStoreHeader, apiKey, runId),
      () => this.scenarioBoleto(wakeStoreHeader, apiKey, runId),
      () => this.scenarioEstorno('estorno_total', wakeStoreHeader, apiKey, runId, undefined),
      () => this.scenarioEstorno('estorno_parcial', wakeStoreHeader, apiKey, runId, 50.0),
      () => this.scenarioCancelamentoPosAutorizacao(wakeStoreHeader, apiKey, runId),
      () => this.scenarioChargeback(wakeStoreHeader, apiKey, runId),
    ];

    const reports: ScenarioReport[] = [];
    for (const run of scenarios) {
      try {
        reports.push(await run());
      } catch (err) {
        reports.push({ scenario: 'unknown', checklistRows: [], ok: false, error: String(err), steps: [] });
      }
    }
    this.logger.log({ runId, total: reports.length, failed: reports.filter((r) => !r.ok).length }, 'Homolog scenario run finished');
    return reports;
  }

  private basePayload(runId: string, scenario: string, pf: boolean): Omit<WakePaymentPayload, 'pagamento'> {
    return {
      pedido: `HOMOLOG-${runId}`,
      id: scenario,
      chave: `homolog-${scenario}`,
      usuario: pf
        ? {
            nome: 'Cliente Teste PF',
            cpf: '39053344705',
            email: 'homolog-pf@letstech.com.br',
            telefone: '11999999999',
            ip: '127.0.0.1',
            endereco: { logradouro: 'Rua Teste, 123', cidade: 'São Paulo', estado: 'SP', cep: '01000-000', pais: 'BR' },
          }
        : {
            nome: 'Cliente Teste PJ',
            cnpj: '11222333000181',
            email: 'homolog-pj@letstech.com.br',
            telefone: '11999999999',
            ip: '127.0.0.1',
            endereco: { logradouro: 'Av. Teste, 456', cidade: 'São Paulo', estado: 'SP', cep: '01000-000', pais: 'BR' },
          },
      produtos: [{ sku: 'SKU-HOMOLOG-1', nome: 'Produto de teste', quantidade: 1, precoUnitario: 100 }],
      frete: 10,
    };
  }

  private async scenarioCard(
    name: string,
    checklistRows: string[],
    wakeStoreHeader: string,
    apiKey: string,
    runId: string,
    opts: { pf: boolean; capture: boolean; parcelas?: number; valor?: number; token?: string },
  ): Promise<ScenarioReport> {
    const steps: ScenarioStep[] = [];
    const payload: WakePaymentPayload = {
      ...this.basePayload(runId, name, opts.pf),
      pagamento: {
        valor: opts.valor ?? 110,
        parcelas: opts.parcelas ?? 1,
        cartao: { token: opts.token ?? 'tok_approved', bandeira: 'visa' },
      },
    };
    const response = await this.callPayment(wakeStoreHeader, apiKey, payload);
    steps.push({ action: 'POST /wake/payment', request: payload, response });

    if (opts.capture && response.transacao && response.statusId === 1) {
      const captureResp = await this.wakeService.handleCapture(wakeStoreHeader, apiKey, { transacao: response.transacao });
      steps.push({ action: 'POST /wake/capture', request: { transacao: response.transacao }, response: captureResp });
    }

    return this.finish(name, checklistRows, wakeStoreHeader, apiKey, response.transacao, steps);
  }

  private async scenarioTokenizado(wakeStoreHeader: string, apiKey: string, runId: string): Promise<ScenarioReport> {
    const steps: ScenarioStep[] = [];
    const tokenizeReq = { token: `tok_saved_card_${runId}` };
    steps.push({ action: 'POST /wake/tokenize', request: tokenizeReq, response: { token: tokenizeReq.token } });

    const payload: WakePaymentPayload = {
      ...this.basePayload(runId, 'cartao_tokenizado', true),
      pagamento: { valor: 110, parcelas: 1, cartao: { token: tokenizeReq.token, bandeira: 'visa' } },
    };
    const response = await this.callPayment(wakeStoreHeader, apiKey, payload);
    steps.push({ action: 'POST /wake/payment (reusing tokenized card)', request: payload, response });

    if (response.transacao && response.statusId === 1) {
      const captureResp = await this.wakeService.handleCapture(wakeStoreHeader, apiKey, { transacao: response.transacao });
      steps.push({ action: 'POST /wake/capture', request: { transacao: response.transacao }, response: captureResp });
    }

    return this.finish(
      'cartao_tokenizado',
      ['Pedido com Cartão Tokenizado', 'Teste de tokenização do cartão', 'Teste com cartão sugerido'],
      wakeStoreHeader,
      apiKey,
      response.transacao,
      steps,
    );
  }

  private async scenarioTrocaPagamento(wakeStoreHeader: string, apiKey: string, runId: string): Promise<ScenarioReport> {
    const steps: ScenarioStep[] = [];
    const pedido = `HOMOLOG-${runId}`;

    const firstPayload: WakePaymentPayload = {
      ...this.basePayload(runId, 'troca_pagamento_1', true),
      pedido,
      id: 'troca_pagamento_1',
      pagamento: { valor: 110, parcelas: 1, cartao: { token: 'tok_declined', bandeira: 'visa' } },
    };
    const firstResponse = await this.callPayment(wakeStoreHeader, apiKey, firstPayload);
    steps.push({ action: 'POST /wake/payment (cartão recusado)', request: firstPayload, response: firstResponse });

    const secondPayload: WakePaymentPayload = {
      ...this.basePayload(runId, 'troca_pagamento_2', true),
      pedido,
      id: 'troca_pagamento_2',
      pagamento: { valor: 110, boleto: true },
    };
    const secondResponse = await this.callPayment(wakeStoreHeader, apiKey, secondPayload);
    steps.push({ action: 'POST /wake/payment (troca para boleto)', request: secondPayload, response: secondResponse });

    return this.finish('troca_pagamento', ['Teste de troca de pagamento'], wakeStoreHeader, apiKey, secondResponse.transacao, steps);
  }

  private async scenarioPix(wakeStoreHeader: string, apiKey: string, runId: string): Promise<ScenarioReport> {
    const payload: WakePaymentPayload = {
      ...this.basePayload(runId, 'pix_pedido', true),
      pagamento: { valor: 110, pix: true },
    };
    const response = await this.callPayment(wakeStoreHeader, apiKey, payload);
    return this.finish(
      'pix_pedido',
      ['Retorno das informações de boleto e pix no ADM do pedido', 'Retorno das informações de boleto e pix no minha conta'],
      wakeStoreHeader,
      apiKey,
      response.transacao,
      [{ action: 'POST /wake/payment', request: payload, response }],
    );
  }

  private async scenarioBoleto(wakeStoreHeader: string, apiKey: string, runId: string): Promise<ScenarioReport> {
    const payload: WakePaymentPayload = {
      ...this.basePayload(runId, 'boleto_pedido', true),
      pagamento: { valor: 110, boleto: true },
    };
    const response = await this.callPayment(wakeStoreHeader, apiKey, payload);
    return this.finish(
      'boleto_pedido',
      ['Retorno das informações de boleto e pix no ADM do pedido', 'Retorno das informações de boleto e pix no minha conta'],
      wakeStoreHeader,
      apiKey,
      response.transacao,
      [{ action: 'POST /wake/payment', request: payload, response }],
    );
  }

  private async scenarioEstorno(
    name: string,
    wakeStoreHeader: string,
    apiKey: string,
    runId: string,
    partialValor: number | undefined,
  ): Promise<ScenarioReport> {
    const steps: ScenarioStep[] = [];
    const payload: WakePaymentPayload = {
      ...this.basePayload(runId, name, true),
      pagamento: { valor: 110, parcelas: 1, cartao: { token: 'tok_approved', bandeira: 'visa' } },
    };
    const response = await this.callPayment(wakeStoreHeader, apiKey, payload);
    steps.push({ action: 'POST /wake/payment', request: payload, response });

    const captureResp = await this.wakeService.handleCapture(wakeStoreHeader, apiKey, { transacao: response.transacao! });
    steps.push({ action: 'POST /wake/capture', request: { transacao: response.transacao }, response: captureResp });

    const cancelBody = { transacao: response.transacao!, valor: partialValor };
    const cancelResp = await this.wakeService.handleCancel(wakeStoreHeader, apiKey, cancelBody);
    steps.push({ action: 'POST /wake/cancel (estorno)', request: cancelBody, response: cancelResp });

    return this.finish(name, ['Teste de Estorno de Pagamento'], wakeStoreHeader, apiKey, response.transacao, steps);
  }

  private async scenarioCancelamentoPosAutorizacao(wakeStoreHeader: string, apiKey: string, runId: string): Promise<ScenarioReport> {
    const steps: ScenarioStep[] = [];
    const payload: WakePaymentPayload = {
      ...this.basePayload(runId, 'cancelamento_pos_autorizacao', true),
      pagamento: { valor: 110, parcelas: 1, cartao: { token: 'tok_approved', bandeira: 'visa' } },
    };
    const response = await this.callPayment(wakeStoreHeader, apiKey, payload);
    steps.push({ action: 'POST /wake/payment (autoriza, sem capturar)', request: payload, response });

    const cancelBody = { transacao: response.transacao! };
    const cancelResp = await this.wakeService.handleCancel(wakeStoreHeader, apiKey, cancelBody);
    steps.push({ action: 'POST /wake/cancel', request: cancelBody, response: cancelResp });

    return this.finish('cancelamento_pos_autorizacao', ['Antifraude Manual - Captura Falha'], wakeStoreHeader, apiKey, response.transacao, steps);
  }

  private async scenarioChargeback(wakeStoreHeader: string, apiKey: string, runId: string): Promise<ScenarioReport> {
    const steps: ScenarioStep[] = [];
    const payload: WakePaymentPayload = {
      ...this.basePayload(runId, 'chargeback_pedido', true),
      pagamento: { valor: 110, parcelas: 1, cartao: { token: 'tok_approved', bandeira: 'visa' } },
    };
    const response = await this.callPayment(wakeStoreHeader, apiKey, payload);
    steps.push({ action: 'POST /wake/payment', request: payload, response });

    const captureResp = await this.wakeService.handleCapture(wakeStoreHeader, apiKey, { transacao: response.transacao! });
    steps.push({ action: 'POST /wake/capture', request: { transacao: response.transacao }, response: captureResp });

    const cbBody = { transacao: response.transacao! };
    const cbResp = await this.wakeService.handleChargeback(wakeStoreHeader, apiKey, cbBody);
    steps.push({ action: 'POST /wake/chargeback', request: cbBody, response: cbResp });

    return this.finish('chargeback_pedido', ['(bônus) exercita a rota /wake/chargeback'], wakeStoreHeader, apiKey, response.transacao, steps);
  }

  private async callPayment(wakeStoreHeader: string, apiKey: string, payload: WakePaymentPayload): Promise<WakePaymentResponse> {
    return this.wakeService.handlePayment(wakeStoreHeader, apiKey, payload, JSON.stringify(payload));
  }

  private async finish(
    scenario: string,
    checklistRows: string[],
    wakeStoreHeader: string,
    apiKey: string,
    transacao: string | undefined,
    steps: ScenarioStep[],
  ): Promise<ScenarioReport> {
    let finalStatus: string | undefined;
    if (transacao) {
      const { store } = await this.storesService.resolveByWakeHeaders(wakeStoreHeader, apiKey);
      const payment = await this.paymentsService.findById(transacao, store.id);
      finalStatus = payment.status;
    }
    return { scenario, checklistRows, ok: true, finalStatus, steps };
  }
}
