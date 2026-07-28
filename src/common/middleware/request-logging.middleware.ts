import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { ulid } from 'ulid';
import { runWithContext } from '../context/request-context';
import { isSensitiveKey } from '../utils/redact';

const logger = new Logger('HTTP');

/** Health checks would otherwise dominate the log volume with no signal. */
const QUIET_PATHS = new Set(['/health', '/health/live', '/health/ready']);

/** Query values are logged by key only when the key is not sensitive. */
function summarizeQuery(query: Request['query']): Record<string, unknown> | undefined {
  const keys = Object.keys(query ?? {});
  if (!keys.length) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    out[k] = isSensitiveKey(k) ? '[REDACTED]' : query[k];
  }
  return out;
}

/**
 * Assigns a trace id, binds it to the async context for the whole request, and
 * logs one line per completed request.
 *
 * Deliberately a middleware rather than an interceptor: middleware runs before
 * guards, so rejected requests (a bad ADMIN_API_KEY, an unsigned WooCommerce
 * call) are logged too — on a payment gateway those attempts are exactly what
 * needs to be visible. An interceptor never sees them.
 *
 * Bodies are never logged here; they carry card tokens and customer PII. What
 * is sent to a provider is logged, redacted, by that provider's adapter.
 */
export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = ulid();
  (req as Request & { traceId: string }).traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    if (QUIET_PATHS.has(req.path) && res.statusCode < 400) return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const payload = {
      traceId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      query: summarizeQuery(req.query),
      // Caller IP: these routes are server-to-server (Wake, the WooCommerce
      // plugin, Zoop/Koin webhooks), so this identifies the integration
      // reaching us — not a cardholder — and is what makes an abusive or
      // misconfigured caller findable.
      ip: req.ip,
      userAgent: req.get('user-agent'),
    };

    const message = 'Request handled';
    if (res.statusCode >= 500) logger.error(payload, message);
    else if (res.statusCode >= 400) logger.warn(payload, message);
    else logger.log(payload, message);
  });

  runWithContext({ traceId }, () => next());
}
