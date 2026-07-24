export interface Money {
  amount: number;
  currency: string;
}

export interface CustomerAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface CreateChargeCmd {
  referenceId: string;
  sellerId: string;
  method: 'pix' | 'boleto' | 'credit_card';
  amount: Money;
  token?: string;
  installments?: number;
  capture?: boolean;
  customer: {
    name: string;
    document: string;
    email: string;
    phone?: string;
    address?: CustomerAddress;
  };
  description?: string;
  metadata?: Record<string, string>;
}

export interface ChargeResult {
  providerId: string;
  status: 'authorized' | 'captured' | 'waiting_payment' | 'failed' | 'reversed' | 'unknown';
  pixQrCode?: string;
  pixQrCodeUrl?: string;
  pixExpiresAt?: Date;
  boletoUrl?: string;
  boletoBarcode?: string;
  boletoExpiresAt?: Date;
  raw: unknown;
}

export interface RefundResult {
  refundId: string;
  status: 'refunded' | 'pending';
  raw: unknown;
}

export interface PaymentProvider {
  createCharge(cmd: CreateChargeCmd): Promise<ChargeResult>;
  capture(chargeId: string, amount?: Money): Promise<ChargeResult>;
  void(chargeId: string): Promise<void>;
  refund(chargeId: string, amount?: Money): Promise<RefundResult>;
  getCharge(chargeId: string): Promise<ChargeResult>;
}
