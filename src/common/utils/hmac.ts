import { createHmac } from 'crypto';

export function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  const payload = `${timestamp}.${body}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function buildWebhookSignatureHeader(secret: string, body: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signWebhookPayload(secret, timestamp, body);
  return `t=${timestamp},v1=${signature}`;
}

export function verifyWebhookSignature(
  secret: string,
  header: string,
  body: string,
  toleranceSeconds = 300,
): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const timestamp = parseInt(parts['t'], 10);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = signWebhookPayload(secret, timestamp, body);
  return timingSafeEqual(expected, parts['v1'] ?? '');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.equals(bufB);
}
