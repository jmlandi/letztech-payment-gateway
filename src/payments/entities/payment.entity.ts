import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { PaymentStatus } from '../../domain/state-machine/allowed-transitions';
import { PaymentEvent } from './payment-event.entity';
import { FraudEvaluation } from './fraud-evaluation.entity';
import { ProviderCharge } from './provider-charge.entity';

@Entity('payments')
@Index(['storeId', 'externalRef'], { unique: true })
export class Payment {
  @PrimaryColumn({ length: 26 })
  id: string;

  @Index()
  @Column({ name: 'store_id', length: 26 })
  storeId: string;

  @Column({ name: 'external_ref', length: 255 })
  externalRef: string;

  @Column({ length: 50, default: PaymentStatus.CREATED })
  status: PaymentStatus;

  @Column({ length: 50 })
  method: string;

  @Column({ type: 'integer' })
  amount: number;

  @Column({ length: 3, default: 'BRL' })
  currency: string;

  @Column({ type: 'jsonb' })
  customer: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  items: unknown[];

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'fraud_fingerprint_id', type: 'varchar', length: 255, nullable: true })
  fraudFingerprintId: string | null;

  @Column({ name: 'pix_qr_code', type: 'text', nullable: true })
  pixQrCode: string | null;

  @Column({ name: 'pix_qr_code_url', type: 'text', nullable: true })
  pixQrCodeUrl: string | null;

  @Column({ name: 'pix_expires_at', type: 'timestamptz', nullable: true })
  pixExpiresAt: Date | null;

  @Column({ name: 'boleto_url', type: 'text', nullable: true })
  boletoUrl: string | null;

  @Column({ name: 'boleto_barcode', type: 'text', nullable: true })
  boletoBarcode: string | null;

  @Column({ name: 'boleto_expires_at', type: 'timestamptz', nullable: true })
  boletoExpiresAt: Date | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255, nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'wake_order_id', type: 'varchar', length: 255, nullable: true })
  wakeOrderId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => PaymentEvent, (e: PaymentEvent) => e.payment)
  events: PaymentEvent[];

  @OneToMany(() => FraudEvaluation, (e: FraudEvaluation) => e.payment)
  fraudEvaluations: FraudEvaluation[];

  @OneToMany(() => ProviderCharge, (c: ProviderCharge) => c.payment)
  providerCharges: ProviderCharge[];
}
