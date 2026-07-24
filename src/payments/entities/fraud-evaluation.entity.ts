import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { Payment } from './payment.entity';

@Entity('fraud_evaluations')
export class FraudEvaluation {
  @PrimaryColumn({ length: 26 })
  id: string;

  @Index()
  @Column({ name: 'payment_id', length: 26 })
  paymentId: string;

  @Column({ name: 'store_id', length: 26 })
  storeId: string;

  @Column({ length: 50 })
  provider: string;

  @Column({ name: 'reference_id', type: 'varchar', length: 255, nullable: true })
  referenceId: string | null;

  @Column({ name: 'evaluation_id', type: 'varchar', length: 255, nullable: true })
  evaluationId: string | null;

  @Column({ length: 50 })
  type: string;

  @Column({ length: 50 })
  status: string;

  @Column({ type: 'integer', nullable: true })
  score: number | null;

  @Column({ type: 'jsonb', nullable: true })
  raw: unknown | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Payment, (p: Payment) => p.fraudEvaluations)
  payment: Payment;
}
