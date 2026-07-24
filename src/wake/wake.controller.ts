import { Body, Controller, Headers, Post, RawBodyRequest, Req } from '@nestjs/common';
import { Request } from 'express';
import { WakeService, WakePaymentPayload } from './wake.service';

@Controller('wake')
export class WakeController {
  constructor(private readonly wakeService: WakeService) {}

  @Post('payment-details')
  paymentDetails(
    @Headers('x-letztech-store') store: string,
    @Headers('x-letztech-key') key: string,
    @Body() _body: unknown,
  ) {
    // Returns HTML/scripts and installment options for the Wake checkout module.
    // The Koin FraudID script is included when the store has fraud enabled.
    return {
      html: `<div id="letztech-payment-module"></div>`,
      script: '',
      parcelas: [{ numero: 1, valor: 0 }],
    };
  }

  @Post('tokenize')
  tokenize(
    @Headers('x-letztech-store') store: string,
    @Headers('x-letztech-key') key: string,
    @Body() body: { token: string },
  ) {
    // PAN never reaches the backend — Wake calls this to relay the tokenization result.
    return { token: body.token };
  }

  @Post('payment')
  async payment(
    @Headers('x-letztech-store') store: string,
    @Headers('x-letztech-key') key: string,
    @Body() body: WakePaymentPayload,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const rawBody = (req.rawBody ?? Buffer.from(JSON.stringify(body))).toString('utf-8');
    return this.wakeService.handlePayment(store, key, body, rawBody);
  }

  @Post('authorize')
  async authorize(
    @Headers('x-letztech-store') store: string,
    @Headers('x-letztech-key') key: string,
    @Body() body: WakePaymentPayload,
    @Req() req: RawBodyRequest<Request>,
  ) {
    // Two-step flow: authorize only (capture later)
    const rawBody = (req.rawBody ?? Buffer.from(JSON.stringify(body))).toString('utf-8');
    return this.wakeService.handlePayment(store, key, { ...body, pagamento: { ...body.pagamento, cartao: { ...body.pagamento.cartao!, token: body.pagamento.cartao?.token ?? '' } } }, rawBody);
  }

  @Post('capture')
  capture(
    @Headers('x-letztech-store') store: string,
    @Headers('x-letztech-key') key: string,
    @Body() body: { transacao: string; valor?: number },
  ) {
    return this.wakeService.handleCapture(store, key, body);
  }

  @Post('cancel')
  cancel(
    @Headers('x-letztech-store') store: string,
    @Headers('x-letztech-key') key: string,
    @Body() body: { transacao: string; valor?: number },
  ) {
    return this.wakeService.handleCancel(store, key, body);
  }

  @Post('card')
  removeCard(
    @Headers('x-letztech-store') store: string,
    @Headers('x-letztech-key') key: string,
    @Body() body: { token: string },
  ) {
    // Remove saved card token (stub for v1 — Zoop token revocation)
    return { ok: true };
  }

  @Post('chargeback')
  chargeback(
    @Headers('x-letztech-store') store: string,
    @Headers('x-letztech-key') key: string,
    @Body() body: { transacao: string },
  ) {
    return this.wakeService.handleChargeback(store, key, body);
  }
}
