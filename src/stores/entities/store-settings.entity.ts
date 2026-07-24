import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { Store } from './store.entity';

@Entity('store_settings')
export class StoreSettings {
  @PrimaryColumn({ length: 26 })
  id: string;

  @Column({ name: 'store_id', length: 26, unique: true })
  storeId: string;

  @Column({ name: 'fraud_enabled', default: false })
  fraudEnabled: boolean;

  @Column({ name: 'koin_private_key_encrypted', type: 'text', nullable: true })
  koinPrivateKeyEncrypted: string | null;

  @Column({ name: 'zoop_seller_id', type: 'varchar', length: 255, nullable: true })
  zoopSellerId: string | null;

  @Column({ name: 'enabled_methods', type: 'text', array: true, default: ['pix', 'boleto', 'credit_card'] })
  enabledMethods: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(() => Store, (s: Store) => s.settings)
  @JoinColumn({ name: 'store_id' })
  store: Store;
}
