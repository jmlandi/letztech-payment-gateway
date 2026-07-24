import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { ulid } from 'ulid';

@Injectable()
export class TraceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { traceId: string }>();
    const response = context.switchToHttp().getResponse<Response>();
    const traceId = ulid();
    request.traceId = traceId;
    response.setHeader('X-Trace-Id', traceId);
    return next.handle().pipe(tap(() => undefined));
  }
}
