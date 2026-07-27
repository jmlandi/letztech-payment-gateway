import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Store } from './store.entity';

@Entity('store_credentials')
export class StoreCredentials {
  @PrimaryColumn({ length: 26 })
  id: string;

  @Column({ name: 'store_id', length: 26 })
  storeId: string;

  @Column({ name: 'api_key_hash', length: 255 })
  apiKeyHash: string;

  @Column({ name: 'hmac_secret_hash', length: 255 })
  hmacSecretHash: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @ManyToOne(() => Store, (s) => s.credentials)
  @JoinColumn({ name: 'store_id' })
  store: Store;
}
