import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('idempotency_keys')
@Index(['storeId', 'keyHash'], { unique: true })
export class IdempotencyKey {
  @PrimaryColumn({ length: 26 })
  id: string;

  @Column({ name: 'key_hash', length: 255 })
  keyHash: string;

  @Index()
  @Column({ name: 'store_id', length: 26 })
  storeId: string;

  @Column({ name: 'request_hash', length: 255 })
  requestHash: string;

  @Column({ type: 'jsonb', nullable: true })
  response: Record<string, unknown> | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
