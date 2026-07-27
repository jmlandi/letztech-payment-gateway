import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentEvent } from './entities/payment-event.entity';
import { FraudEvaluation } from './entities/fraud-evaluation.entity';
import { ProviderCharge } from './entities/provider-charge.entity';
import { OutboxEvent } from '../outbox/entities/outbox.entity';
import { PaymentStatus } from '../domain/state-machine/allowed-transitions';
import { PaymentStateMachine } from '../domain/state-machine/payment-state-machine';
import { generateId } from '../common/utils/id';

export interface CreatePaymentCmd {
  storeId: string;
  externalRef: string;
  method: string;
  amount: number;
  currency?: string;
  customer: Record<string, unknown>;
  items: unknown[];
  metadata?: Record<string, unknown>;
  fraudFingerprintId?: string;
  idempotencyKey?: string;
  wakeOrderId?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentEvent) private readonly eventRepo: Repository<PaymentEvent>,
    @InjectRepository(FraudEvaluation) private readonly fraudEvalRepo: Repository<FraudEvaluation>,
    @InjectRepository(ProviderCharge) private readonly chargeRepo: Repository<ProviderCharge>,
    @InjectRepository(OutboxEvent) private readonly outboxRepo: Repository<OutboxEvent>,
    private readonly dataSource: DataSource,
  ) {}

  async create(cmd: CreatePaymentCmd): Promise<Payment> {
    const payment = this.paymentRepo.create({
      id: generateId('pay'),
      storeId: cmd.storeId,
      externalRef: cmd.externalRef,
      status: PaymentStatus.CREATED,
      method: cmd.method,
      amount: cmd.amount,
      currency: cmd.currency ?? 'BRL',
      customer: cmd.customer,
      items: cmd.items,
      metadata: cmd.metadata ?? null,
      fraudFingerprintId: cmd.fraudFingerprintId ?? null,
      idempotencyKey: cmd.idempotencyKey ?? null,
      wakeOrderId: cmd.wakeOrderId ?? null,
    });
    return this.paymentRepo.save(payment);
  }

  async transition(
    paymentId: string,
    storeId: string,
    toStatus: PaymentStatus,
    actor: string,
    raw?: unknown,
  ): Promise<Payment> {
    return this.dataSource.transaction(async (manager) => {
      const payment = await manager
        .getRepository(Payment)
        .createQueryBuilder('p')
        .setLock('pessimistic_write')
        .where('p.id = :id AND p.store_id = :storeId', { id: paymentId, storeId })
        .getOne();

      if (!payment) throw new NotFoundException({ error: { code: 'not_found', message: 'Payment not found' } });

      PaymentStateMachine.validate(payment.status, toStatus);

      const fromStatus = payment.status;
      payment.status = toStatus;
      await manager.save(Payment, payment);

      const event = manager.getRepository(PaymentEvent).create({
        id: generateId('evt'),
        paymentId,
        storeId,
        type: `payment.${toStatus}`,
        fromStatus,
        toStatus,
        actor,
        raw: raw ?? null,
      });
      await manager.save(PaymentEvent, event);

      const outbox = manager.getRepository(OutboxEvent).create({
        id: generateId('obx'),
        eventType: `payment.${toStatus}`,
        aggregateId: paymentId,
        storeId,
        payload: {
          payment: {
            id: payment.id,
            external_ref: payment.externalRef,
            status: toStatus,
            amount: payment.amount,
            method: payment.method,
          },
        },
        publishedAt: null,
      });
      await manager.save(OutboxEvent, outbox);

      this.logger.log({ paymentId, fromStatus, toStatus, actor }, 'Payment state transition');
      return payment;
    });
  }

  async saveFraudEvaluation(data: Omit<FraudEvaluation, 'id' | 'createdAt' | 'updatedAt' | 'payment'>): Promise<FraudEvaluation> {
    const record = this.fraudEvalRepo.create({ id: generateId('fev'), ...data });
    return this.fraudEvalRepo.save(record);
  }

  async saveProviderCharge(data: Omit<ProviderCharge, 'id' | 'createdAt' | 'updatedAt' | 'payment'>): Promise<ProviderCharge> {
    const record = this.chargeRepo.create({ id: generateId('chg'), ...data });
    return this.chargeRepo.save(record);
  }

  async updatePaymentPixData(paymentId: string, storeId: string, data: { pixQrCode: string; pixQrCodeUrl: string; pixExpiresAt: Date }): Promise<void> {
    await this.paymentRepo.update({ id: paymentId, storeId }, data);
  }

  async updatePaymentBoletoData(paymentId: string, storeId: string, data: { boletoUrl: string; boletoBarcode: string; boletoExpiresAt: Date }): Promise<void> {
    await this.paymentRepo.update({ id: paymentId, storeId }, data);
  }

  async findById(id: string, storeId: string): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({ where: { id, storeId }, relations: ['events'] });
    if (!payment) throw new NotFoundException({ error: { code: 'not_found', message: 'Payment not found' } });
    return payment;
  }

  /** Used to recover from a retry landing after the idempotency record was created
   * but before its response was saved (crash/timeout mid-request) -- lets a handler
   * return the payment's current state instead of re-creating it and hitting the
   * (store_id, external_ref) unique constraint. */
  async findByExternalRef(storeId: string, externalRef: string): Promise<Payment | null> {
    return this.paymentRepo.findOne({ where: { storeId, externalRef } });
  }

  async findAll(storeId: string, filters: { status?: string; from?: string; to?: string; page?: number; limit?: number }): Promise<{ data: Payment[]; total: number }> {
    const qb = this.paymentRepo.createQueryBuilder('p').where('p.store_id = :storeId', { storeId });
    if (filters.status) qb.andWhere('p.status = :status', { status: filters.status });
    if (filters.from) qb.andWhere('p.created_at >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('p.created_at <= :to', { to: filters.to });
    const limit = filters.limit ?? 20;
    const page = filters.page ?? 1;
    qb.take(limit).skip((page - 1) * limit).orderBy('p.created_at', 'DESC');
    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findByProviderEvent(providerEventId: string): Promise<PaymentEvent | null> {
    return this.eventRepo.findOne({ where: { raw: { id: providerEventId } as never } });
  }
}
