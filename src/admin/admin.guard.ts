import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { constantTimeCompare } from '../common/utils/constant-time-compare';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly adminKey: string;

  constructor(private readonly config: ConfigService) {
    this.adminKey = config.getOrThrow<string>('ADMIN_API_KEY');
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization ?? '';
    const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!constantTimeCompare(key, this.adminKey)) {
      throw new UnauthorizedException({ error: { code: 'unauthorized', message: 'Invalid admin key' } });
    }
    return true;
  }
}
