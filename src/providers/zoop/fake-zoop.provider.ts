import { Logger } from '@nestjs/common';
import {
  ChargeResult,
  CreateChargeCmd,
  Money,
  PaymentProvider,
  RefundResult,
} from '../../domain/interfaces/payment-provider.interface';
import { generateId } from '../../common/utils/id';

/**
 * Sentinel zoop_seller_id that routes a store to FakeZoopProvider instead of
 * the real Zoop adapter. Set by ProvidersService.getPaymentProvider and
 * exempted from live seller verification in StoresService.createStore.
 */
export const FAKE_ZOOP_SELLER_ID = 'zoop_fake_homolog';

type DeclineReason = 'insufficient_funds' | 'stolen_card' | 'generic';

/**
 * Card tokens the Wake homologation harness (/homolog) can send to force a
 * given outcome, since we have no Zoop staging credentials to produce real
 * declines. Any other token (including opaque tokens from the real
 * tokenize.js widget) is treated as approved.
 */
const DECLINE_TOKENS: Record<string, DeclineReason> = {
  tok_declined: 'generic',
  tok_declined_insufficient_funds: 'insufficient_funds',
  tok_declined_stolen_card: 'stolen_card',
};

interface FakeCharge {
  id: string;
  amount: number;
  status: ChargeResult['status'];
}

/**
 * Stands in for Zoop when a store's zoop_seller_id is FAKE_ZOOP_SELLER_ID.
 * Built for Wake connector homologation (see /homolog), where LetzTech has
 * no Zoop staging/homolog credentials to drive real charges against.
 */
export class FakeZoopProvider implements PaymentProvider {
  private readonly logger = new Logger(FakeZoopProvider.name);
  private readonly charges = new Map<string, FakeCharge>();

  async createCharge(cmd: CreateChargeCmd): Promise<ChargeResult> {
    if (cmd.method === 'pix') return this.createPix(cmd);
    if (cmd.method === 'boleto') return this.createBoleto(cmd);
    return this.createCard(cmd);
  }

  private createPix(cmd: CreateChargeCmd): ChargeResult {
    const charge = this.register(cmd, 'waiting_payment');
    return {
      providerId: charge.id,
      status: 'waiting_payment',
      pixQrCode: `00020126580014BR.GOV.BCB.PIX0136${charge.id}5204000053039865802BR5913LETZTECH+FAKE6009SAO+PAULO62070503***6304FAKE`,
      pixQrCodeUrl: `https://fake-zoop.homolog.letstech.com.br/pix/${charge.id}`,
      pixExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      raw: { fake: true, id: charge.id, status: 'pending' },
    };
  }

  private createBoleto(cmd: CreateChargeCmd): ChargeResult {
    const charge = this.register(cmd, 'waiting_payment');
    const digits = charge.id.replace(/\D/g, '').padEnd(39, '0').slice(0, 39);
    return {
      providerId: charge.id,
      status: 'waiting_payment',
      boletoUrl: `https://fake-zoop.homolog.letstech.com.br/boleto/${charge.id}`,
      boletoBarcode: `23793${digits}`,
      boletoExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      raw: { fake: true, id: charge.id, status: 'pending' },
    };
  }

  private createCard(cmd: CreateChargeCmd): ChargeResult {
    const declineReason = cmd.token ? DECLINE_TOKENS[cmd.token] : undefined;
    const status: ChargeResult['status'] = declineReason
      ? 'failed'
      : cmd.capture !== false
        ? 'captured'
        : 'authorized';
    const charge = this.register(cmd, status);
    this.logger.log({ chargeId: charge.id, token: cmd.token, status, declineReason }, 'Fake Zoop card charge');
    return {
      providerId: charge.id,
      status,
      raw: { fake: true, id: charge.id, status, decline_reason: declineReason },
    };
  }

  async capture(chargeId: string, amount?: Money): Promise<ChargeResult> {
    const charge = this.get(chargeId);
    charge.status = 'captured';
    return {
      providerId: charge.id,
      status: charge.status,
      raw: { fake: true, id: charge.id, status: 'succeeded', amount: amount?.amount ?? charge.amount },
    };
  }

  async void(chargeId: string): Promise<void> {
    const charge = this.get(chargeId);
    charge.status = 'reversed';
  }

  async refund(chargeId: string, amount?: Money): Promise<RefundResult> {
    const charge = this.get(chargeId);
    return {
      refundId: generateId('fkrf'),
      status: 'refunded',
      raw: { fake: true, id: charge.id, refunded_amount: amount?.amount ?? charge.amount },
    };
  }

  async getCharge(chargeId: string): Promise<ChargeResult> {
    const charge = this.get(chargeId);
    return { providerId: charge.id, status: charge.status, raw: { fake: true, id: charge.id, status: charge.status } };
  }

  private register(cmd: CreateChargeCmd, status: ChargeResult['status']): FakeCharge {
    const charge: FakeCharge = { id: generateId('fkzp'), amount: cmd.amount.amount, status };
    this.charges.set(charge.id, charge);
    return charge;
  }

  private get(chargeId: string): FakeCharge {
    const charge = this.charges.get(chargeId);
    if (!charge) throw new Error(`Fake Zoop charge not found: ${chargeId}`);
    return charge;
  }
}
