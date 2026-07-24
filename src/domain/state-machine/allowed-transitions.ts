export enum PaymentStatus {
  CREATED = 'created',
  UNDER_REVIEW = 'under_review',
  APPROVED_RISK = 'approved_risk',
  WAITING_PAYMENT = 'waiting_payment',
  AUTHORIZED = 'authorized',
  CAPTURED = 'captured',
  SETTLED = 'settled',
  REFUSED = 'refused',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
  CHARGEBACK = 'chargeback',
  EXPIRED = 'expired',
}

export const ALLOWED_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.CREATED]: [
    PaymentStatus.UNDER_REVIEW,
    PaymentStatus.APPROVED_RISK,
    PaymentStatus.WAITING_PAYMENT,
    PaymentStatus.AUTHORIZED,
    PaymentStatus.CANCELLED,
    PaymentStatus.EXPIRED,
  ],
  [PaymentStatus.UNDER_REVIEW]: [
    PaymentStatus.APPROVED_RISK,
    PaymentStatus.REFUSED,
    PaymentStatus.EXPIRED,
  ],
  [PaymentStatus.APPROVED_RISK]: [
    PaymentStatus.AUTHORIZED,
    PaymentStatus.WAITING_PAYMENT,
    PaymentStatus.REFUSED,
  ],
  [PaymentStatus.WAITING_PAYMENT]: [
    PaymentStatus.CAPTURED,
    PaymentStatus.EXPIRED,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.AUTHORIZED]: [
    PaymentStatus.CAPTURED,
    PaymentStatus.CANCELLED,
    PaymentStatus.REFUSED,
  ],
  [PaymentStatus.CAPTURED]: [
    PaymentStatus.SETTLED,
    PaymentStatus.REFUNDED,
    PaymentStatus.CHARGEBACK,
  ],
  [PaymentStatus.SETTLED]: [
    PaymentStatus.CHARGEBACK,
  ],
  [PaymentStatus.REFUSED]: [],
  [PaymentStatus.CANCELLED]: [],
  [PaymentStatus.REFUNDED]: [],
  [PaymentStatus.CHARGEBACK]: [],
  [PaymentStatus.EXPIRED]: [],
};
