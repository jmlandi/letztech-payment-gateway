import 'reflect-metadata';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { TraceInterceptor } from './common/interceptors/trace.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Serve static assets (browser-only helpers + the admin risk-review page)
  // under /public. The page itself is a static file; the data it shows comes
  // from the AdminGuard-protected /v1/risk/evaluations endpoint.
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/public' });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new TraceInterceptor());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`API running on port ${port}`);
}

bootstrap();
