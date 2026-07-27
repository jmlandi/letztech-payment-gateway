import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStoresNameUnique1785168196301 implements MigrationInterface {
  name = 'AddStoresNameUnique1785168196301';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Remove duplicate-named stores that never got credentials/settings/payments
    // wired up (leftover incomplete rows) so the unique constraint below can apply.
    // Any duplicate that *does* have real data is left in place and will make the
    // ALTER TABLE fail loudly, rather than silently deleting something in use.
    await queryRunner.query(`
      DELETE FROM stores s
      WHERE EXISTS (SELECT 1 FROM stores s2 WHERE s2.name = s.name AND s2.id <> s.id)
        AND NOT EXISTS (SELECT 1 FROM store_settings ss WHERE ss.store_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM store_credentials sc WHERE sc.store_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.store_id = s.id)
    `);

    await queryRunner.query(`
      ALTER TABLE stores ADD CONSTRAINT stores_name_key UNIQUE (name)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE stores DROP CONSTRAINT stores_name_key
    `);
  }
}
