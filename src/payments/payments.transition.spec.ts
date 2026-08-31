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
 * Database-backed test for transition()'s '*' storeId wildcard, used by
 * provider webhooks (Zoop, Koin) that don't carry our store scoping.
 *
 * Skipped when DATABASE_URL is absent (local runs without Postgres); CI
 * provides one.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('transition() with storeId "*" (Postgres)', () => {
  let ds: DataSource;
  let service: PaymentsService;
  let payments: Repository<Payment>;
  let events: Repository<PaymentEvent>;
  let outbox: Repository<OutboxEvent>;

  const STORE = 'str_test000000000000000002';

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: DATABASE_URL,
      entities: [Payment, PaymentEvent, FraudEvaluation, ProviderCharge, OutboxEvent],
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
