import { Params } from 'nestjs-pino';
import { getTraceId } from '../context/request-context';

/**
 * Structured JSON logging for log aggregation (Loki/Datadog/CloudWatch).
 *
 * The codebase already logs as `logger.log({ fields }, 'message')`, which is
 * exactly pino's signature — those fields become top-level JSON keys and the
 * message becomes `msg`, so no call site changes.
 */
export function loggerParams(env: NodeJS.ProcessEnv = process.env): Params {
  const isProduction = env.NODE_ENV === 'production';

  return {
    pinoHttp: {
      level: env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),

      // Request logging is handled by requestLoggingMiddleware, which knows
      // which paths to keep quiet and how to redact the query string. Leaving
      // pino-http's own autoLogging on would duplicate every line.
      autoLogging: false,
      quietReqLogger: true,

      // Stamps the active trace id onto *every* log line, including ones deep
      // in a service that never sees the request object.
      mixin() {
        const traceId = getTraceId();
        return traceId ? { traceId } : {};
      },

      // Safety net beneath `redactDeep`: catches a sensitive field on a log
      // line added later that forgets to redact. Not a replacement for it —
      // pino matches fixed paths and its `*` spans exactly one level, so each
      // key is listed both at the root and one level down; `redactDeep` is
      // what actually walks arbitrary depth.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-api-key"]',
          ...['authorization', 'password', 'secret', 'token', 'token_id', 'cvv',
            'taxpayer_id', 'document', 'cpf', 'cnpj', 'card_number']
            .flatMap((key) => [key, `*.${key}`]),
        ],
        censor: '[REDACTED]',
      },

      // Human-readable locally; single-line JSON in production so the log
      // shipper can parse it.
      ...(isProduction
        ? {}
        : {
            transport: {
              target: 'pino-pretty',
              options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
            },
          }),
    },
  };
}
