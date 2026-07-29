/**
 * Redaction for anything that goes into a log line.
 *
 * A payment gateway's logs are a liability if they carry credentials, card
 * data or customer PII, so nothing reaches the logger unfiltered: outbound
 * provider payloads and remote error bodies are walked and scrubbed by key.
 */

const REDACTED = '[REDACTED]';

/**
 * Keys whose value must never appear in a log, matched case-insensitively
 * against the normalized key (non-alphanumerics stripped, so `x-api-key`,
 * `x_api_key` and `xApiKey` all collapse to `xapikey`).
 *
 * Covers three classes:
 *  - credentials (auth headers, API keys, private keys)
 *  - card data (PAN, CVV, holder, token ids usable to charge)
 *  - PII and payable codes (taxpayer id, contact info, PIX EMV, boleto barcode)
 */
const SENSITIVE_KEYS = new Set([
  // credentials
  'authorization', 'auth', 'password', 'secret', 'apikey', 'xapikey',
  'privatekey', 'publishablekey', 'key', 'cert', 'certificate', 'httpsagent',
  'accesstoken', 'refreshtoken', 'bearer', 'signature',
  // card data
  'cardnumber', 'number', 'pan', 'cvv', 'cvc', 'securitycode', 'holdername',
  'cardholder', 'expirationmonth', 'expirationyear', 'tokenid', 'token',
  // PII
  'taxpayerid', 'taxid', 'document', 'cpf', 'cnpj', 'email', 'phone',
  'phonenumber', 'ip', 'ipaddress', 'birthdate', 'address', 'line1', 'line2',
  'postalcode',
  // payable codes — anyone holding these can settle the charge
  'emv', 'qrcode', 'barcode', 'digitableline',
]);

const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 10;
const MAX_STRING_LENGTH = 512;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

/**
 * Deep-copies `value` with sensitive keys replaced and size bounded, so a
 * large or hostile provider response can't blow up the log pipeline.
 */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();

  if (depth >= MAX_DEPTH) return '[depth-limit]';

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((v) => redactDeep(v, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`…${value.length - MAX_ARRAY_ITEMS} more`);
    return items;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redactDeep(v, depth + 1);
    }
    return out;
  }

  // functions, symbols, bigint — never useful in a log line
  return `[${typeof value}]`;
}

/** Last 4 characters of a token, for correlating retries without exposing it. */
export function tokenFingerprint(token: unknown): string | null {
  if (typeof token !== 'string' || token.length < 4) return null;
  return `…${token.slice(-4)}`;
}

/**
 * Collapses variable path segments (marketplace, transaction and seller ids)
 * into placeholders so log lines group by route instead of fanning out into
 * one distinct value per transaction.
 */
export function normalizeZoopPath(url: string | undefined): string {
  if (!url) return '';
  const path = url.split('?')[0];
  return path
    .replace(/\/marketplaces\/[^/]+/, '/marketplaces/:marketplaceId')
    .replace(/\/transactions\/[^/]+/, '/transactions/:transactionId')
    .replace(/\/sellers\/[^/]+/, '/sellers/:sellerId');
}
