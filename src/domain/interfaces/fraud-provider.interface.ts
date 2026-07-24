export type FraudVerdict = {
  status: 'approved' | 'denied' | 'received';
  score: number;
  evaluationId?: string;
  raw: unknown;
};

export type TxOutcome = 'captured' | 'refused' | 'cancelled';

export interface FraudContext {
  referenceId: string;
  orderId: string;
  amount: number;
  currency: string;
  fingerprintId?: string;
  customer: {
    name: string;
    document: string;
    email: string;
    phone?: string;
    ip?: string;
    address?: {
      line1: string;
      city: string;
      state: string;
      postal_code: string;
      country: string;
    };
  };
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    unitAmount: number;
  }>;
  shippingAmount?: number;
  callbackUrl?: string;
}

export interface FraudProvider {
  preEvaluate?(ctx: FraudContext): Promise<FraudVerdict>;
  evaluate(ctx: FraudContext): Promise<FraudVerdict>;
  checkStatus(referenceId: string): Promise<FraudVerdict>;
  notifyOutcome?(referenceId: string, outcome: TxOutcome): Promise<void>;
}
