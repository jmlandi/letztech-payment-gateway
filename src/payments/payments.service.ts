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
    const saved = await this.fraudEvalRepo.save(record);
    // Structured, PII-free risk log for observability (Loki/Datadog/CloudWatch).
    this.logger.log(
      {
        fraudEvaluationId: saved.id,
        paymentId: saved.paymentId,
        storeId: saved.storeId,
        provider: saved.provider,
        type: saved.type,
        status: saved.status,
        score: saved.score,
      },
      'Fraud evaluation recorded',
    );
    return saved;
  }

  /**
   * Persists a fraud verdict so it shows up in risk review afterwards.
   *
   * Non-fatal on purpose: this is an audit record, and failing to write it
   * must never refuse a payment the provider already approved. A failure is
   * logged at error level instead of propagating.
   *
   * Noop verdicts are recorded too — knowing a charge was never screened is
   * itself the finding when a store still has fraudEnabled=false.
   */
  async recordFraudEvaluation(params: {
    paymentId: string;
    storeId: string;
    provider: string;
    type: 'pre_evaluation' | 'evaluation';
    verdict: { status: string; score: number; evaluationId?: string; raw: unknown };
  }): Promise<void> {
    try {
      await this.saveFraudEvaluation({
        paymentId: params.paymentId,
        storeId: params.storeId,
        provider: params.provider,
        referenceId: params.paymentId,
        evaluationId: params.verdict.evaluationId ?? null,
        type: params.type,
        status: params.verdict.status,
        score: params.verdict.score ?? null,
        raw: params.verdict.raw ?? null,
      });
    } catch (err) {
      this.logger.error(
        { paymentId: params.paymentId, storeId: params.storeId, provider: params.provider, type: params.type, err },
        'Failed to persist fraud evaluation (payment flow continues)',
      );
    }
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

  /**
   * Read-only risk review: fraud evaluations joined with their payment.
   * The raw provider payload (`raw`) is intentionally never selected here —
   * it contains unmasked PII and must not leave the database via this path.
   * Callers are responsible for masking the payment's customer blob.
   */
  async findFraudEvaluations(filters: {
    storeId?: string;
    status?: string;
    provider?: string;
    minScore?: number;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: Array<FraudEvaluation & { payment: Payment }>; total: number }> {
    const qb = this.fraudEvalRepo
      .createQueryBuilder('fe')
      .innerJoinAndSelect('fe.payment', 'p')
      // Explicit select — never include fe.raw (unmasked PII payload).
      .select([
        'fe.id',
        'fe.paymentId',
        'fe.storeId',
        'fe.provider',
        'fe.referenceId',
        'fe.evaluationId',
        'fe.type',
        'fe.status',
        'fe.score',
        'fe.createdAt',
        'p.id',
        'p.externalRef',
        'p.status',
        'p.method',
        'p.amount',
        'p.currency',
        'p.customer',
        'p.createdAt',
      ]);

    if (filters.storeId) qb.andWhere('fe.store_id = :storeId', { storeId: filters.storeId });
    if (filters.status) qb.andWhere('fe.status = :status', { status: filters.status });
    if (filters.provider) qb.andWhere('fe.provider = :provider', { provider: filters.provider });
    if (filters.minScore !== undefined) qb.andWhere('fe.score >= :minScore', { minScore: filters.minScore });
    if (filters.from) qb.andWhere('fe.created_at >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('fe.created_at <= :to', { to: filters.to });

    const limit = Math.min(filters.limit ?? 20, 100);
    const page = filters.page ?? 1;
    // Must be the entity property (createdAt), not the column (created_at):
    // take/skip over a join makes TypeORM resolve the sort against property
    // metadata, and a column name there throws at runtime.
    qb.take(limit).skip((page - 1) * limit).orderBy('fe.createdAt', 'DESC');

    const [data, total] = await qb.getManyAndCount();
    return { data: data as Array<FraudEvaluation & { payment: Payment }>, total };
  }

  /**
   * Card-testing view: charge attempts clustered by customer document.
   *
   * Reads `payments` rather than `fraud_evaluations` on purpose — a store with
   * `fraudEnabled: false` (the default, and what WooCommerce auto-provisioning
   * creates) never reaches Koin, so a fraud run leaves no evaluation behind but
   * always leaves payment rows. Repeated attempts on one document with most of
   * them refused is the signature of someone walking a list of stolen cards.
   *
   * Aggregate only: no raw payload, and the caller masks the identity fields.
   */
  async findDeclinedAttemptClusters(filters: {
    storeId?: string;
    method?: string;
    since?: string;
    minRefused?: number;
    limit?: number;
  }): Promise<DeclinedAttemptCluster[]> {
    const since = filters.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const minRefused = filters.minRefused ?? 2;
    const limit = Math.min(filters.limit ?? 25, 100);

    const qb = this.paymentRepo
      .createQueryBuilder('p')
      .select("p.customer->>'document'", 'document')
      .addSelect("MIN(p.customer->>'name')", 'name')
      .addSelect("MIN(p.customer->>'email')", 'email')
      .addSelect('COUNT(*)::int', 'attempts')
      .addSelect("COUNT(*) FILTER (WHERE p.status = 'refused')::int", 'refused')
      .addSelect('COUNT(DISTINCT p.amount)::int', 'distinctAmounts')
      .addSelect('MIN(p.amount)::int', 'minAmount')
      .addSelect('MAX(p.amount)::int', 'maxAmount')
      .addSelect('MIN(p.created_at)', 'firstAt')
      .addSelect('MAX(p.created_at)', 'lastAt')
      .addSelect('(ARRAY_AGG(p.id ORDER BY p.created_at DESC))[1:5]', 'samplePaymentIds')
      .where('p.created_at >= :since', { since })
      .andWhere("p.customer->>'document' IS NOT NULL")
      .groupBy("p.customer->>'document'")
      .having("COUNT(*) FILTER (WHERE p.status = 'refused') >= :minRefused", { minRefused })
      .orderBy('refused', 'DESC')
      .addOrderBy('attempts', 'DESC')
      .limit(limit);

    if (filters.storeId) qb.andWhere('p.store_id = :storeId', { storeId: filters.storeId });
    if (filters.method) qb.andWhere('p.method = :method', { method: filters.method });

    return qb.getRawMany<DeclinedAttemptCluster>();
  }
}

export interface DeclinedAttemptCluster {
  document: string;
  name: string | null;
  email: string | null;
  attempts: number;
  refused: number;
  distinctAmounts: number;
  minAmount: number;
  maxAmount: number;
  firstAt: Date;
  lastAt: Date;
  samplePaymentIds: string[];
}
