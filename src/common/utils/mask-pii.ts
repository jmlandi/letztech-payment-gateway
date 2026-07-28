/**
 * PII masking helpers for read-only admin/observability surfaces.
 *
 * These exist so risk-review responses can identify a transaction (enough to
 * correlate it against a payment) without ever returning raw customer PII.
 * Masking is one-way and lossy on purpose — never use these values for
 * anything but display. The raw fraud-evaluation payload (`raw`) is never
 * exposed by the endpoints that use this module.
 */

const DOT = '•'; // • — visually distinct from a literal '*' in a UI

/** Keep the last `visible` characters of a digit string, mask the rest. */
function maskKeepLastDigits(value: string, visible: number): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= visible) return DOT.repeat(digits.length);
  return DOT.repeat(digits.length - visible) + digits.slice(-visible);
}

/** CPF/CNPJ or any document number → reveal only the last 2 digits. */
export function maskDocument(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return maskKeepLastDigits(value, 2);
}

/** Reveal only the last 4 digits of a phone number. */
export function maskPhone(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return maskKeepLastDigits(value, 4);
}

/** Reveal the first character of the local part and the full domain. */
export function maskEmail(value: unknown): string | null {
  if (typeof value !== 'string' || !value.includes('@')) return null;
  const [local, domain] = value.split('@');
  if (!local || !domain) return null;
  const head = local.slice(0, 1);
  return `${head}${DOT.repeat(Math.max(local.length - 1, 3))}@${domain}`;
}

/** IPv4 → keep first octet; IPv6/other → keep first segment. */
export function maskIp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (value.includes('.')) {
    const [first] = value.split('.');
    return `${first}.${DOT}.${DOT}.${DOT}`;
  }
  if (value.includes(':')) {
    const [first] = value.split(':');
    return `${first}:${DOT}${DOT}`;
  }
  return DOT.repeat(value.length);
}

/** Reveal the first name token, mask the remainder of each other token. */
export function maskName(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const tokens = value.trim().split(/\s+/);
  return tokens
    .map((tok, i) => (i === 0 ? tok : `${tok.slice(0, 1)}${DOT.repeat(Math.max(tok.length - 1, 1))}`))
    .join(' ');
}

/**
 * Mask a stored `payment.customer` blob (shape is not guaranteed), reading the
 * common identity keys and masking whatever is present. Never returns raw
 * values, never throws on unexpected shapes.
 */
export function maskCustomer(customer: unknown): Record<string, string | null> {
  const c = (customer ?? {}) as Record<string, unknown>;
  return {
    name: maskName(c.name),
    document: maskDocument(c.document ?? c.cpf ?? c.cnpj ?? c.tax_id),
    email: maskEmail(c.email),
    phone: maskPhone(c.phone ?? c.phone_number),
    ip: maskIp(c.ip ?? c.ip_address),
  };
}
