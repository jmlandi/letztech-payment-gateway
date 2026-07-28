import { DataSource, Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentEvent } from './entities/payment-event.entity';
import { FraudEvaluation } from './entities/fraud-evaluation.entity';
import { ProviderCharge } from './entities/provider-charge.entity';
import { OutboxEvent } from '../outbox/entities/outbox.entity';
import { PaymentsService } from './payments.service';
import { PaymentStatus } from '../domain/state-machine/allowed-transitions';

/**
 * Database-backed tests for the read queries behind risk review.
 *
 * These exist because both of those queries type-check and still failed at
 * runtime: `findFraudEvaluations` threw on every call because `take`/`skip`
 * over a join makes TypeORM resolve the sort against *property* metadata, so
 * the column name `fe.created_at` blew up where `fe.createdAt` works. Only a
 * real database catches that class of bug.
 *
 * Skipped when DATABASE_URL is absent (local runs without Postgres); CI
 * provides one.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('payments read queries (Postgres)', () => {
  let ds: DataSource;
  let service: PaymentsService;
  let payments: Repository<Payment>;

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
  }, 30_000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    await ds.getRepository(FraudEvaluation).delete({ storeId: STORE });
    await payments.delete({ storeId: STORE });
  });

  async function seedPayment(id: string, over: Partial<Payment> = {}): Promise<Payment> {
    return payments.save(
      payments.create({
        id,
        storeId: STORE,
        externalRef: `ext-${id}`,
        status: PaymentStatus.REFUSED,
        method: 'credit_card',
        amount: 150,
        currency: 'BRL',
        customer: { name: 'Carlos Testador', document: '11122233344', email: 'c@x.com' },
        items: [],
        ...over,
      } as Partial<Payment>),
    );
  }

  describe('findFraudEvaluations', () => {
    it('runs with pagination over the join and returns the evaluation with its payment', async () => {
      await seedPayment('pay_test00000000000000001', { amount: 4242 });
      await service.recordFraudEvaluation({
        paymentId: 'pay_test00000000000000001',
        storeId: STORE,
        provider: 'koin',
        type: 'evaluation',
        verdict: { status: 'denied', score: 91, evaluationId: 'ev_1', raw: { reason: 'velocity' } },
      });

      const { data, total } = await service.findFraudEvaluations({ storeId: STORE, page: 1, limit: 10 });

      expect(total).toBe(1);
      expect(data[0]).toMatchObject({ provider: 'koin', status: 'denied', score: 91, evaluationId: 'ev_1' });
      expect(data[0].payment.amount).toBe(4242);
    });

    it('never selects the raw provider payload', async () => {
      await seedPayment('pay_test00000000000000002');
      await service.recordFraudEvaluation({
        paymentId: 'pay_test00000000000000002',
        storeId: STORE,
        provider: 'koin',
        type: 'evaluation',
        verdict: { status: 'denied', score: 80, raw: { secretReason: 'do-not-log-me' } },
      });

      const { data } = await service.findFraudEvaluations({ storeId: STORE });

      expect(data[0].raw).toBeUndefined();
      expect(JSON.stringify(data)).not.toContain('do-not-log-me');
    });

    it('filters by status', async () => {
      await seedPayment('pay_test00000000000000003');
      await service.recordFraudEvaluation({
        paymentId: 'pay_test00000000000000003', storeId: STORE, provider: 'noop',
        type: 'evaluation', verdict: { status: 'approved', score: 0, raw: null },
      });

      expect((await service.findFraudEvaluations({ storeId: STORE, status: 'denied' })).total).toBe(0);
      expect((await service.findFraudEvaluations({ storeId: STORE, status: 'approved' })).total).toBe(1);
    });
  });

  describe('recordFraudEvaluation', () => {
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

  describe('findDeclinedAttemptClusters', () => {
    it('returns the repeat offender and leaves a single retry out', async () => {
      // Attacker: 4 attempts on one document, 3 refused.
      for (let i = 1; i <= 4; i++) {
        await seedPayment(`pay_atk0000000000000000${i}`, {
          status: i === 4 ? PaymentStatus.CAPTURED : PaymentStatus.REFUSED,
          amount: 100 + i,
        });
      }
      // Ordinary customer: one refusal then paid.
      await seedPayment('pay_ok00000000000000001', {
        status: PaymentStatus.REFUSED, amount: 24990,
        customer: { name: 'Maria', document: '55566677788', email: 'm@x.com' },
      });

      const clusters = await service.findDeclinedAttemptClusters({ storeId: STORE, minRefused: 2 });

      expect(clusters).toHaveLength(1);
      expect(clusters[0]).toMatchObject({ document: '11122233344', attempts: 4, refused: 3 });
      expect(clusters[0].samplePaymentIds.length).toBeGreaterThan(0);
    });

    it('honours the refusal threshold', async () => {
      await seedPayment('pay_one0000000000000001', { status: PaymentStatus.REFUSED });

      expect(await service.findDeclinedAttemptClusters({ storeId: STORE, minRefused: 2 })).toHaveLength(0);
      expect(await service.findDeclinedAttemptClusters({ storeId: STORE, minRefused: 1 })).toHaveLength(1);
    });
  });
});
