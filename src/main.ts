import 'reflect-metadata';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { Logger as NestLogger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { requestLoggingMiddleware } from './common/middleware/request-logging.middleware';

async function bootstrap() {
  // bufferLogs holds startup output until pino takes over, so boot-time lines
  // are structured too instead of falling back to the default logger.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));

  // First in the chain: assigns the trace id, binds it to the async context
  // for downstream provider calls, and logs every request — including ones
  // rejected by a guard, which an interceptor would never see.
  app.use(requestLoggingMiddleware);

  // Serve browser-only static assets (e.g. tokenize.js, the client-side
  // Zoop tokenization widget) under /public.
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/public' });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  new NestLogger('Bootstrap').log({ port }, 'API started');
}

bootstrap();
