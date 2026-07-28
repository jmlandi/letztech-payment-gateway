import { AdminController } from './admin.controller';
import { DeclinedAttemptCluster } from '../payments/payments.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Covers the shaping the controller does on top of the SQL aggregate: the
 * derived refusal rate and time span an operator reads to tell card testing
 * from an ordinary retry, plus the masking guarantee.
 *
 * The aggregate query itself is exercised against Postgres, not here.
 */
function cluster(over: Partial<DeclinedAttemptCluster> = {}): DeclinedAttemptCluster {
  return {
    document: '11122233344',
    name: 'Carlos Testador',
    email: 'carlos@tempmail.com',
    attempts: 12,
    refused: 11,
    distinctAmounts: 12,
    minAmount: 107,
    maxAmount: 184,
    firstAt: new Date('2026-07-28T15:00:00Z'),
    lastAt: new Date('2026-07-28T15:11:00Z'),
    samplePaymentIds: ['pay_a', 'pay_b'],
    ...over,
  };
}

function build(clusters: DeclinedAttemptCluster[]) {
  const payments = { findDeclinedAttemptClusters: jest.fn().mockResolvedValue(clusters) };
  return { controller: new AdminController(payments as any, {} as any), payments };
}

describe('GET /v1/risk/declined-attempts', () => {
  it('derives the refusal rate and the window span', async () => {
    const { controller } = build([cluster()]);
    const [row] = (await controller.listDeclinedAttempts()).data;

    expect(row.refusalRate).toBe(92); // 11/12
    expect(row.spanMinutes).toBe(11);
    expect(row.attempts).toBe(12);
    expect(row.refused).toBe(11);
  });

  it('masks identity and never returns the raw document or e-mail', async () => {
    const { controller } = build([cluster()]);
    const response = await controller.listDeclinedAttempts();
    const serialized = JSON.stringify(response);

    expect(response.data[0].document).toBe('•••••••••44');
    expect(serialized).not.toContain('11122233344');
    expect(serialized).not.toContain('carlos@tempmail.com');
    // Payment ids stay intact — they are what you pivot on.
    expect(response.data[0].samplePaymentIds).toEqual(['pay_a', 'pay_b']);
  });

  it('passes filters through, parsing the numeric ones', async () => {
    const { controller, payments } = build([]);
    await controller.listDeclinedAttempts('str_1', 'credit_card', '2026-07-28T00:00:00Z', '5', '10');

    expect(payments.findDeclinedAttemptClusters).toHaveBeenCalledWith({
      storeId: 'str_1',
      method: 'credit_card',
      since: '2026-07-28T00:00:00Z',
      minRefused: 5,
      limit: 10,
    });
  });

  it('leaves optional numeric filters undefined when absent', async () => {
    const { controller, payments } = build([]);
    await controller.listDeclinedAttempts();

    const args = payments.findDeclinedAttemptClusters.mock.calls[0][0];
    expect(args.minRefused).toBeUndefined();
    expect(args.limit).toBeUndefined();
  });

  it('does not divide by zero on an empty cluster', async () => {
    const { controller } = build([cluster({ attempts: 0, refused: 0 })]);
    expect((await controller.listDeclinedAttempts()).data[0].refusalRate).toBe(0);
  });
});
