import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

interface SanitizedError {
  name?: string;
  message?: string;
  stack?: string;
  code?: unknown;
  response?: { status?: unknown; data?: unknown };
}

function sanitizeException(exception: unknown): SanitizedError {
  if (!(exception instanceof Error)) return { message: String(exception) };

  const err = exception as Error & { code?: unknown; response?: { status?: unknown; data?: unknown } };
  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
    code: err.code,
    // Axios errors carry the full request config (incl. httpsAgent, which
    // embeds raw TLS cert/key material) on `.config` — never log that.
    // Only the actual HTTP response status/body from the remote side is safe.
    response: err.response ? { status: err.response.status, data: err.response.data } : undefined,
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const traceId: string = (request as Request & { traceId?: string }).traceId ?? 'unknown';

    if (status >= 500) {
      this.logger.error({ traceId, path: request.url, exception: sanitizeException(exception) }, 'Unhandled exception');
    }

    let body: Record<string, unknown>;
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null && 'error' in res) {
        body = res as Record<string, unknown>;
      } else {
        body = { error: { code: 'http_error', message: typeof res === 'string' ? res : exception.message, trace_id: traceId } };
      }
    } else {
      body = { error: { code: 'internal_error', message: 'An unexpected error occurred', trace_id: traceId } };
    }

    response.status(status).json(body);
  }
}
