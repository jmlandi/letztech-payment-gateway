import { Logger } from '@nestjs/common';
import { AxiosAdapter } from 'axios';
import { ZoopPaymentAdapter } from './zoop-payment.adapter';
import { runWithContext } from '../../common/context/request-context';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PUBLISHABLE_KEY = 'zpk_live_SUPERSECRET';
const X_API_KEY = 'xkey_SUPERSECRET';
const CARD_TOKEN = 'tok_live_SUPERSECRET_wxyz';

/** Everything the logger was handed, flattened for leak assertions. */
function captureLogs() {
  const lines: Array<{ level: string; payload: any; message: unknown }> = [];
  const spy = (level: 'log' | 'warn' | 'error') =>
    jest.spyOn(Logger.prototype, level).mockImplementation((payload: any, message?: any) => {
      lines.push({ level, payload, message });
    });
  spy('log'); spy('warn'); spy('error');
  return lines;
}

function buildAdapter(respond: AxiosAdapter) {
  const adapter = new ZoopPaymentAdapter({
    marketplaceId: 'mkt_1',
    publishableKey: PUBLISHABLE_KEY,
    xApiKey: X_API_KEY,
    sandbox: true,
  });
  (adapter as any).http.defaults.adapter = respond;
  return adapter;
}

const chargeCmd = {
  referenceId: 'pay_01HZ',
  sellerId: 'sel_1',
  method: 'credit_card' as const,
  amount: { amount: 1990, currency: 'BRL' },
  token: CARD_TOKEN,
  customer: { name: 'João Marcos', document: '12345678901', email: 'j@x.com', phone: '11988881234' },
};

describe('ZoopPaymentAdapter logging', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs the attempt and the outcome, correlated by trace and reference id', async () => {
    const lines = captureLogs();
    const adapter = buildAdapter(async (config) => ({
      data: { id: 'tx_9', status: 'succeeded' },
      status: 201, statusText: 'Created', headers: {}, config,
    }));

    await runWithContext({ traceId: 'trace_abc' }, () => adapter.createCharge(chargeCmd));

    expect(lines.map((l) => l.message)).toEqual(['Zoop request sent', 'Zoop response received']);

    const [sent, received] = lines;
    expect(sent.payload).toMatchObject({
      traceId: 'trace_abc',
      provider: 'zoop',
      operation: 'createCharge.credit_card',
      referenceId: 'pay_01HZ',
      method: 'POST',
      path: '/v1/marketplaces/:marketplaceId/transactions',
      tokenFp: '…wxyz',
    });
    expect(received.payload).toMatchObject({
      traceId: 'trace_abc',
      referenceId: 'pay_01HZ',
      status: 201,
      providerId: 'tx_9',
      providerStatus: 'succeeded',
    });
    expect(typeof received.payload.durationMs).toBe('number');
  });

  it('never writes credentials, the card token or customer PII to the log', async () => {
    const lines = captureLogs();
    const adapter = buildAdapter(async (config) => ({
      data: { id: 'tx_9', status: 'succeeded' },
      status: 201, statusText: 'Created', headers: {}, config,
    }));

    await adapter.createCharge(chargeCmd);

    const serialized = JSON.stringify(lines);
    for (const secret of [PUBLISHABLE_KEY, X_API_KEY, CARD_TOKEN, '12345678901', 'j@x.com', '11988881234']) {
      expect(serialized).not.toContain(secret);
    }
    // The token is only ever present as its non-chargeable fingerprint.
    expect(serialized).toContain('…wxyz');
  });

  it('logs a refusal as a warning without leaking the request config', async () => {
    const lines = captureLogs();
    const adapter = buildAdapter(async (config) => {
      const err: any = new Error('Request failed with status code 402');
      err.isAxiosError = true;
      err.config = config;
      err.response = { status: 402, data: { error: { message: 'card declined' } }, headers: {}, config };
      throw err;
    });

    await expect(adapter.createCharge(chargeCmd)).rejects.toThrow();

    const failure = lines.find((l) => l.message === 'Zoop call refused');
    expect(failure).toBeDefined();
    expect(failure!.level).toBe('warn');
    expect(failure!.payload).toMatchObject({ status: 402, referenceId: 'pay_01HZ' });
    expect(JSON.stringify(lines)).not.toContain(PUBLISHABLE_KEY);
    expect(JSON.stringify(lines)).not.toContain(X_API_KEY);
  });

  it('logs an unreachable Zoop as an error, carrying the transport code', async () => {
    const lines = captureLogs();
    const adapter = buildAdapter(async () => {
      const err: any = new Error('timeout of 20000ms exceeded');
      err.isAxiosError = true;
      err.code = 'ECONNABORTED';
      throw err;
    });

    await expect(adapter.createCharge(chargeCmd)).rejects.toThrow();

    const failure = lines.find((l) => l.message === 'Zoop call failed');
    expect(failure).toBeDefined();
    expect(failure!.level).toBe('error');
    expect(failure!.payload.code).toBe('ECONNABORTED');
  });

  it('does not warn when a seller lookup legitimately 404s', async () => {
    const lines = captureLogs();
    const adapter = buildAdapter(async (config) => {
      const err: any = new Error('Request failed with status code 404');
      err.isAxiosError = true;
      err.config = config;
      err.response = { status: 404, data: {}, headers: {}, config };
      throw err;
    });

    await expect(adapter.getSeller('sel_missing')).resolves.toBeNull();

    expect(lines.some((l) => l.level === 'warn' || l.level === 'error')).toBe(false);
    expect(lines.some((l) => l.message === 'Zoop resource not found')).toBe(true);
  });
});
