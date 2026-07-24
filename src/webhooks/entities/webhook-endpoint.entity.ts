import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('webhook_endpoints')
export class WebhookEndpoint {
  @PrimaryColumn({ length: 26 })
  id: string;

  @Index()
  @Column({ name: 'store_id', length: 26 })
  storeId: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ name: 'secret_hash', length: 255 })
  secretHash: string;

  @Column({ name: 'enabled_events', type: 'text', array: true })
  enabledEvents: string[];

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
