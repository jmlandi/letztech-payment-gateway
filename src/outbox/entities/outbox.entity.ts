import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('outbox')
export class OutboxEvent {
  @PrimaryColumn({ length: 26 })
  id: string;

  @Column({ name: 'event_type', length: 100 })
  eventType: string;

  @Index()
  @Column({ name: 'aggregate_id', length: 26 })
  aggregateId: string;

  @Column({ name: 'store_id', length: 26 })
  storeId: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;
}
