import { FraudContext, FraudProvider, FraudVerdict, TxOutcome } from '../../../domain/interfaces/fraud-provider.interface';

export class NoopFraudProvider implements FraudProvider {
  async evaluate(_ctx: FraudContext): Promise<FraudVerdict> {
    return { status: 'approved', score: 0, raw: null };
  }

  async checkStatus(_referenceId: string): Promise<FraudVerdict> {
    return { status: 'approved', score: 0, raw: null };
  }

  async notifyOutcome(_referenceId: string, _outcome: TxOutcome): Promise<void> {
    // no-op
  }
}
