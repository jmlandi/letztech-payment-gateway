import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * A plain singleton rather than a Nest provider: the values it exports are
 * needed from request-logging.middleware.ts, which runs before Nest's DI
 * container is available (it's wired via app.use(), not a NestMiddleware
 * class) — see main.ts. Importing a module-level singleton avoids having to
 * turn that middleware into an injectable just to reach this.
 */
export const register = new Registry();
collectDefaultMetrics({ register });

/**
 * Buckets tuned for a payment API talking to an external provider (Zoop) —
 * most requests should land well under 250ms, but a slow provider call can
 * push a request into the multi-second range and that's the signal worth
 * keeping resolution on.
 */
const httpRequestDuration = new Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'status'],
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

export function recordHttpMetrics(params: { method: string; route: string; status: number; durationMs: number }): void {
  const labels = { method: params.method, route: params.route, status: String(params.status) };
  httpRequestDuration.observe(labels, params.durationMs);
  httpRequestsTotal.inc(labels);
}
