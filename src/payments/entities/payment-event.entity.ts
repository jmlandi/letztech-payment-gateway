import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryColumn } from 'typeorm';
import { Payment } from './payment.entity';

@Entity('payment_events')
export class PaymentEvent {
  @PrimaryColumn({ length: 26 })
  id: string;

  @Index()
  @Column({ name: 'payment_id', length: 26 })
  paymentId: string;

  @Index()
  @Column({ name: 'store_id', length: 26 })
  storeId: string;

  @Column({ length: 100 })
  type: string;

  @Column({ name: 'from_status', type: 'varchar', length: 50, nullable: true })
  fromStatus: string | null;

  @Column({ name: 'to_status', type: 'varchar', length: 50, nullable: true })
  toStatus: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  actor: string | null;

  @Column({ type: 'jsonb', nullable: true })
  raw: unknown | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Payment, (p: Payment) => p.events)
  payment: Payment;
}
