import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { constantTimeCompare } from '../common/utils/constant-time-compare';

@Injectable()
export class WooCommerceGuard implements CanActivate {
  private readonly sharedKey: string;

  constructor(config: ConfigService) {
    this.sharedKey = config.getOrThrow<string>('WOOCOMMERCE_SHARED_KEY');
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.headers['x-letztech-key'];
    if (typeof key !== 'string' || !constantTimeCompare(key, this.sharedKey)) {
      throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Invalid key' } });
    }
    return true;
  }
}
