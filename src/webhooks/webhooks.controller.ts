import { Body, Controller, Logger, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentsService } from '../payments/payments.service';
import { PaymentStatus } from '../domain/state-machine/allowed-transitions';
import { OutboxEvent } from '../outbox/entities/outbox.entity';
import { StoresService } from '../stores/stores.service';
import { RiskService } from '../risk/risk.service';

// Zoop webhook event types → payment status mapping
const ZOOP_STATUS_MAP: Record<string, PaymentStatus | null> = {
  'transaction.authorized': PaymentStatus.AUTHORIZED,
  'transaction.paid': PaymentStatus.CAPTURED,
  'transaction.succeeded': PaymentStatus.CAPTURED,
  'transaction.failed': PaymentStatus.REFUSED,
  'transaction.reversed': PaymentStatus.CANCELLED,
  'transaction.charged_back': PaymentStatus.CHARGEBACK,
  'transaction.refunded': PaymentStatus.REFUNDED,
  'transaction.expired': PaymentStatus.EXPIRED,
  'receivable.paid': PaymentStatus.SETTLED,
};

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly storesService: StoresService,
    private readonly riskService: RiskService,
    @InjectRepository(OutboxEvent) private readonly outboxRepo: Repository<OutboxEvent>,
  ) {}

  @Post('zoop')
  async handleZoop(@Body() body: Record<string, unknown>): Promise<{ ok: boolean }> {
    const eventType = body['type'] as string | undefined;
    const eventId = body['id'] as string | undefined;
    const transactionId = (body['payload'] as Record<string, unknown>)?.['id'] as string | undefined;
    const referenceId = (body['payload'] as Record<string, unknown>)?.['reference_id'] as string | undefined;

    this.logger.log({ eventId, eventType, transactionId }, 'Zoop webhook received');

    if (!eventId || !eventType || !referenceId) return { ok: true };

    // Deduplication: check if we've already processed this event
    const existing = await this.paymentsService.findByProviderEvent(eventId);
    if (existing) {
      this.logger.log({ eventId }, 'Zoop event already processed — skipping');
      return { ok: true };
    }

    const targetStatus = ZOOP_STATUS_MAP[eventType];
    if (!targetStatus) {
      this.logger.log({ eventType }, 'Zoop event type not mapped — archiving only');
      return { ok: true };
    }

    try {
      await this.paymentsService.transition(referenceId, '*', targetStatus, 'zoop_webhook', body);
    } catch (err) {
      this.logger.warn({ eventId, err }, 'Zoop webhook state transition failed — check state or event order');
    }

    return { ok: true };
  }

  @Post('koin')
  async handleKoin(@Body() body: Record<string, unknown>): Promise<{ ok: boolean }> {
    const evaluationId = body['evaluation_id'] as string | undefined;
    const referenceId = body['reference_id'] as string | undefined;
    const status = body['status'] as string | undefined;

    this.logger.log({ evaluationId, referenceId, status }, 'Koin webhook received');

    if (!referenceId || !status) return { ok: true };

    const targetStatus =
      status === 'approved' ? PaymentStatus.APPROVED_RISK
      : status === 'denied' ? PaymentStatus.REFUSED
      : null;

    if (!targetStatus) return { ok: true };

    try {
      // Only reached for evaluations Koin resolved asynchronously (previously
      // "received"/under manual review) -- automatic approve/deny happens
      // synchronously in WakeService and never calls back here.
      const payment = await this.paymentsService.transition(referenceId, '*', targetStatus, 'koin_webhook', body);
      if (status === 'denied') {
        const settings = await this.storesService.getSettings(payment.storeId);
        await this.riskService.notify(settings, referenceId, { kind: 'not_collected' });
        await this.riskService.notify(settings, referenceId, { kind: 'cancelled', reason: 'requested_by_commerce' });
      }
    } catch (err) {
      this.logger.warn({ evaluationId, err }, 'Koin webhook state transition failed');
    }

    return { ok: true };
  }
}
