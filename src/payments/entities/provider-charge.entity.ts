import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { Payment } from './payment.entity';

@Entity('provider_charges')
export class ProviderCharge {
  @PrimaryColumn({ length: 26 })
  id: string;

  @Index()
  @Column({ name: 'payment_id', length: 26 })
  paymentId: string;

  @Column({ name: 'store_id', length: 26 })
  storeId: string;

  @Column({ length: 50 })
  provider: string;

  @Column({ name: 'provider_id', type: 'varchar', length: 255, nullable: true })
  providerId: string | null;

  @Column({ length: 50 })
  type: string;

  @Column({ length: 50 })
  status: string;

  @Column({ type: 'integer' })
  amount: number;

  @Column({ type: 'jsonb', nullable: true })
  raw: unknown | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Payment, (p: Payment) => p.providerCharges)
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;
}
