import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

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
      this.logger.error({ traceId, path: request.url, exception }, 'Unhandled exception');
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
