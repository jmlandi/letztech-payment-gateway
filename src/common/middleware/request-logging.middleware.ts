import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { ulid } from 'ulid';
import { runWithContext } from '../context/request-context';
import { isSensitiveKey } from '../utils/redact';
import { recordHttpMetrics } from '../../metrics/metrics.registry';

const logger = new Logger('HTTP');

/**
 * Successful health probes are not logged: Docker polls `/healthz` every 15s
 * on both the app and worker containers, which would bury real traffic under
 * thousands of empty lines a day. A failing probe still logs — that is signal.
 * Must match HealthController's route (`@Controller('healthz')`).
 *
 * /metrics is the same story once Prometheus starts scraping it every 15s —
 * must match MetricsController's route (`@Controller('metrics')`).
 */
const QUIET_PATHS = new Set(['/healthz', '/metrics']);

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
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    // req.route.path is the matched route *pattern* (e.g. /v1/payments/:id),
    // not the raw path — using the raw path here would make every ULID
    // payment id its own Prometheus time series. Same reasoning as
    // normalizeZoopPath in ../utils/redact.ts.
    recordHttpMetrics({
      method: req.method,
      route: req.route?.path ?? 'unmatched',
      status: res.statusCode,
      durationMs: Math.round(durationMs),
    });

    if (QUIET_PATHS.has(req.path) && res.statusCode < 400) return;

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
