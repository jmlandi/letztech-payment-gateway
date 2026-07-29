import { DataSource, Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentEvent } from './entities/payment-event.entity';
import { FraudEvaluation } from './entities/fraud-evaluation.entity';
import { ProviderCharge } from './entities/provider-charge.entity';
import { OutboxEvent } from '../outbox/entities/outbox.entity';
import { PaymentsService } from './payments.service';

/**
 * Database-backed test for recordFraudEvaluation's non-fatal write path.
 *
 * Skipped when DATABASE_URL is absent (local runs without Postgres); CI
 * provides one.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('recordFraudEvaluation (Postgres)', () => {
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
