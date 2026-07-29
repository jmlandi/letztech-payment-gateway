import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { register } from './metrics.registry';

/**
 * Only ever reached over the internal docker network (Prometheus calling
 * app:3000/metrics directly) — Caddy blocks /metrics on both public site
 * blocks before it ever reaches the reverse_proxy rule. See caddy/Caddyfile.
 */
@Controller('metrics')
export class MetricsController {
  @Get()
  async metrics(@Res() res: Response): Promise<void> {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  }
}
