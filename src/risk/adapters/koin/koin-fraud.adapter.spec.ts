import { AxiosAdapter } from 'axios';
import { KoinFraudAdapter } from './koin-fraud.adapter';
import { FraudContext } from '../../../domain/interfaces/fraud-provider.interface';

/* eslint-disable @typescript-eslint/no-explicit-any */

function buildAdapter(respond: AxiosAdapter) {
  const adapter = new KoinFraudAdapter('sk_test', true);
  (adapter as any).http.defaults.adapter = respond;
  return adapter;
}

const baseCtx: FraudContext = {
  referenceId: 'pay_01HZ',
  orderId: 'ord_1',
  amount: 9990,
  currency: 'BRL',
  method: 'credit_card',
  installments: 3,
  storeCode: 'store_123',
  card: { brand: 'visa' },
  customer: {
    name: 'João Marcos',
    document: '123.456.789-01',
    email: 'joao@example.com',
    phone: '11988881234',
  },
  items: [{ sku: 'sku_1', name: 'Produto', quantity: 2, unitAmount: 4995 }],
  shippingAmount: 500,
};

describe('KoinFraudAdapter payload', () => {
  it('converts amounts from cents to decimal reais, not raw cents', async () => {
    let sentBody: any;
    const adapter = buildAdapter(async (config) => {
      sentBody = JSON.parse(config.data as string);
      return { data: { id: 'ev_1', status: 'approved', score: 10 }, status: 200, statusText: 'OK', headers: {}, config };
    });

    await adapter.evaluate(baseCtx);

    expect(sentBody.transaction.total_amount).toEqual({ currency: 'BRL', value: 99.9 });
    expect(sentBody.items[0].price).toEqual({ currency: 'BRL', value: 49.95 });
    expect(sentBody.shipping.price).toEqual({ currency: 'BRL', value: 5 });
  });

  it('maps method, installments, store code and CPF/CNPJ document type', async () => {
    let sentBody: any;
    const adapter = buildAdapter(async (config) => {
      sentBody = JSON.parse(config.data as string);
      return { data: { id: 'ev_1', status: 'approved', score: 10 }, status: 200, statusText: 'OK', headers: {}, config };
    });

    await adapter.evaluate(baseCtx);

    expect(sentBody.payments[0]).toMatchObject({ method: 'CreditCard', installments: 3 });
    expect(sentBody.store).toEqual({ code: 'store_123' });
    expect(sentBody.buyer.document).toEqual({ type: 'CPF', number: '123.456.789-01' });

    await adapter.evaluate({ ...baseCtx, customer: { ...baseCtx.customer, document: '12345678000199' } });
    expect(sentBody.buyer.document.type).toBe('CNPJ');
  });

  it('queries evaluation status by our own reference_id, not Koin evaluation_id', async () => {
    let sentUrl = '';
    let sentParams: any;
    const adapter = buildAdapter(async (config) => {
      sentUrl = config.url ?? '';
      sentParams = config.params;
      return { data: { id: 'ev_1', status: 'received', score: 0 }, status: 200, statusText: 'OK', headers: {}, config };
    });

    await adapter.checkStatus('pay_01HZ');

    expect(sentUrl).toBe('/antifraud/evaluations/pay_01HZ');
    expect(sentParams).toEqual({ field: 'REFERENCE_ID' });
  });
});
