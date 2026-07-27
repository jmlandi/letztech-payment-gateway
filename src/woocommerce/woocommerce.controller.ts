import { Body, Controller, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { WooCommerceService, WooCommercePaymentPayload } from './woocommerce.service';
import { WooCommerceGuard } from './woocommerce.guard';

@Controller('woocommerce')
@UseGuards(WooCommerceGuard)
export class WooCommerceController {
  constructor(private readonly wooCommerceService: WooCommerceService) {}

  @Post('payment')
  async payment(@Body() body: WooCommercePaymentPayload, @Req() req: RawBodyRequest<Request>) {
    const rawBody = (req.rawBody ?? Buffer.from(JSON.stringify(body))).toString('utf-8');
    return this.wooCommerceService.handlePayment(body, rawBody);
  }
}
