import { DataSource, Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentEvent } from './entities/payment-event.entity';
import { FraudEvaluation } from './entities/fraud-evaluation.entity';
import { ProviderCharge } from './entities/provider-charge.entity';
import { OutboxEvent } from '../outbox/entities/outbox.entity';
import { PaymentsService } from './payments.service';
import { PaymentStatus } from '../domain/state-machine/allowed-transitions';
import { generateId } from '../common/utils/id';

/**
 * Database-backed tests for PaymentsService. Share a single DataSource
 * across describe blocks in this file -- a second DataSource elsewhere
 * running `migrationsRun: true` against the same CI Postgres races on
 * creating the migrations table (duplicate key on pg_type).
 *
 * Skipped when DATABASE_URL is absent (local runs without Postgres); CI
 * provides one.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('PaymentsService (Postgres)', () => {
  let ds: DataSource;
  let service: PaymentsService;
  let payments: Repository<Payment>;
  let events: Repository<PaymentEvent>;
  let outbox: Repository<OutboxEvent>;

  const STORE = 'str_test000000000000000001';

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: DATABASE_URL,
      entities: [Payment, PaymentEvent, FraudEvaluation, ProviderCharge, OutboxEvent],
      // Run the real migrations rather than synchronizing from entities: the
      // two disagree (migrations declare VARCHAR(30) ids, the entities say
      // length 26, and generateId produces 30 chars), so a synchronized
      // schema rejects writes that production accepts. Testing against the
      // migrations is what production actually runs.
      migrations: [`${__dirname}/../database/migrations/*{.ts,.js}`],
      migrationsRun: true,
      synchronize: false,
    });
    await ds.initialize();
    service = new PaymentsService(
      ds.getRepository(Payment),
      ds.getRepository(PaymentEvent),
      ds.getRepository(FraudEvaluation),
      ds.getRepository(ProviderCharge),
      ds.getRepository(OutboxEvent),
      ds,
    );
    payments = ds.getRepository(Payment);
    events = ds.getRepository(PaymentEvent);
    outbox = ds.getRepository(OutboxEvent);
  }, 30_000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  describe('recordFraudEvaluation', () => {
    beforeEach(async () => {
      await ds.getRepository(FraudEvaluation).delete({ storeId: STORE });
      await payments.delete({ storeId: STORE });
    });

    it('does not throw when the row cannot be written, so a payment is never refused by it', async () => {
      await expect(
        service.recordFraudEvaluation({
          paymentId: 'pay_does_not_exist_000001',
          storeId: STORE,
          provider: 'koin',
          type: 'evaluation',
          verdict: { status: 'denied', score: 1, raw: null },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('transition() with storeId "*"', () => {
    afterEach(async () => {
      await events.delete({ storeId: STORE });
      await outbox.delete({ storeId: STORE });
      await payments.delete({ storeId: STORE });
    });

    it('resolves the payment by id alone and records the real store_id, not the literal "*"', async () => {
      const paymentId = generateId('pay');
      await payments.save(
        payments.create({
          id: paymentId,
          storeId: STORE,
          externalRef: 'ext_1',
          status: PaymentStatus.AUTHORIZED,
          method: 'credit_card',
          amount: 1000,
          customer: {},
          items: [],
        }),
      );

      const updated = await service.transition(paymentId, '*', PaymentStatus.CAPTURED, 'zoop_webhook');
      expect(updated.status).toBe(PaymentStatus.CAPTURED);

      const event = await events.findOne({ where: { paymentId } });
      expect(event?.storeId).toBe(STORE);

      const outboxRow = await outbox.findOne({ where: { aggregateId: paymentId } });
      expect(outboxRow?.storeId).toBe(STORE);
    });

    it('still throws not_found when no payment exists for that id, wildcard storeId or not', async () => {
      await expect(service.transition('pay_does_not_exist_000002', '*', PaymentStatus.CAPTURED, 'zoop_webhook')).rejects.toThrow();
    });
  });
});
