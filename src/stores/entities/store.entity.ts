import { Column, CreateDateColumn, Entity, OneToMany, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { StoreCredentials } from './store-credentials.entity';
import { StoreSettings } from './store-settings.entity';

@Entity('stores')
export class Store {
  @PrimaryColumn({ length: 26 })
  id: string;

  @Column({ length: 255, unique: true })
  name: string;

  @Column({ name: 'wake_store_header', type: 'varchar', length: 255, unique: true, nullable: true })
  wakeStoreHeader: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => StoreCredentials, (c) => c.store)
  credentials: StoreCredentials[];

  @OneToOne(() => StoreSettings, (s) => s.store)
  settings: StoreSettings;
}
