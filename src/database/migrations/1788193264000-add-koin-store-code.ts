import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKoinStoreCode1788193264000 implements MigrationInterface {
  name = 'AddKoinStoreCode1788193264000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE store_settings ADD COLUMN koin_store_code VARCHAR(255)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE store_settings DROP COLUMN koin_store_code
    `);
  }
}
