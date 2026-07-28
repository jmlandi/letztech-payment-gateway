import { isSensitiveKey, normalizeZoopPath, redactDeep, tokenFingerprint } from './redact';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

describe('redact', () => {
  describe('isSensitiveKey', () => {
    it('matches regardless of casing or separators', () => {
      for (const k of ['x-api-key', 'x_api_key', 'xApiKey', 'X-API-KEY']) {
        expect(isSensitiveKey(k)).toBe(true);
      }
    });
    it('flags credentials, card data and PII', () => {
      for (const k of ['authorization', 'token_id', 'cvv', 'taxpayer_id', 'email', 'emv', 'barcode']) {
        expect(isSensitiveKey(k)).toBe(true);
      }
    });
    it('leaves operational fields alone', () => {
      for (const k of ['amount', 'currency', 'status', 'reference_id', 'payment_type', 'id']) {
        expect(isSensitiveKey(k)).toBe(false);
      }
    });
  });

  describe('redactDeep', () => {
    it('removes sensitive values but keeps the transaction shape', () => {
      const out = redactDeep({
        amount: 1990,
        currency: 'BRL',
        reference_id: 'pay_01',
        payment_type: 'credit',
        source: { type: 'card', token_id: 'tok_secret_abcd', usage: 'single_use' },
        customer: { name: 'João', taxpayer_id: '12345678901', email: 'j@x.com' },
      }) as Any;

      expect(out.amount).toBe(1990);
      expect(out.reference_id).toBe('pay_01');
      expect(out.source.token_id).toBe('[REDACTED]');
      expect(out.source.type).toBe('card');
      expect(out.customer.taxpayer_id).toBe('[REDACTED]');
      expect(out.customer.email).toBe('[REDACTED]');
      expect(out.customer.name).toBe('João');
    });

    it('never leaks a secret anywhere in the serialized output', () => {
      const serialized = JSON.stringify(
        redactDeep({
          nested: { deeper: { authorization: 'Basic zpk_live_supersecret' } },
          list: [{ cvv: '123' }, { pan: '4111111111111111' }],
        }),
      );
      expect(serialized).not.toContain('zpk_live_supersecret');
      expect(serialized).not.toContain('4111111111111111');
      expect(serialized).not.toContain('123');
    });

    it('bounds depth, array length and string size', () => {
      expect(redactDeep({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({ a: { b: { c: { d: '[depth-limit]' } } } });

      const big = redactDeep(Array.from({ length: 25 }, (_, i) => i)) as unknown[];
      expect(big).toHaveLength(11);
      expect(big[10]).toBe('…15 more');

      const long = redactDeep('x'.repeat(600)) as string;
      expect(long.endsWith('…[truncated]')).toBe(true);
      expect(long.length).toBeLessThan(600);
    });

    it('passes through primitives and handles null/undefined', () => {
      expect(redactDeep(null)).toBeNull();
      expect(redactDeep(undefined)).toBeUndefined();
      expect(redactDeep(42)).toBe(42);
      expect(redactDeep(true)).toBe(true);
    });
  });

  describe('tokenFingerprint', () => {
    it('keeps only the last 4 characters', () => {
      expect(tokenFingerprint('tok_1234567890abcd')).toBe('…abcd');
    });
    it('returns null for non-strings or too-short values', () => {
      expect(tokenFingerprint(undefined)).toBeNull();
      expect(tokenFingerprint('ab')).toBeNull();
    });
  });

  describe('normalizeZoopPath', () => {
    it('collapses ids so log lines group by route', () => {
      expect(normalizeZoopPath('/v1/marketplaces/mkt_1/transactions'))
        .toBe('/v1/marketplaces/:marketplaceId/transactions');
      expect(normalizeZoopPath('/v1/marketplaces/mkt_1/transactions/tx_9/capture'))
        .toBe('/v1/marketplaces/:marketplaceId/transactions/:transactionId/capture');
      expect(normalizeZoopPath('/v1/marketplaces/mkt_1/sellers/sel_5'))
        .toBe('/v1/marketplaces/:marketplaceId/sellers/:sellerId');
    });
    it('drops the query string and tolerates undefined', () => {
      expect(normalizeZoopPath('/v1/x?token=secret')).toBe('/v1/x');
      expect(normalizeZoopPath(undefined)).toBe('');
    });
  });
});
