import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A read-only Postgres role for Grafana's datasource — no existing pattern
 * in this repo for extra DB roles (no init scripts, no
 * docker-entrypoint-initdb.d; everything schema-related goes through
 * migrations), so this is that pattern's first use.
 *
 * CREATE ROLE is the only non-idempotent statement here, guarded via the
 * pg_roles existence check. The GRANTs are naturally idempotent (repeating
 * a grant is a no-op) and re-run every time this migration runs, so a role
 * created out of band still ends up with the right privileges.
 */
export class AddGrafanaReaderRole1785295698907 implements MigrationInterface {
  name = 'AddGrafanaReaderRole1785295698907';

  async up(queryRunner: QueryRunner): Promise<void> {
    const password = process.env.GRAFANA_DB_PASSWORD;
    if (!password) {
      throw new Error(
        'GRAFANA_DB_PASSWORD must be set — refusing to create grafana_reader with no/predictable password',
      );
    }

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_reader') THEN
          CREATE ROLE grafana_reader LOGIN PASSWORD '${password.replace(/'/g, "''")}';
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`GRANT CONNECT ON DATABASE gateway TO grafana_reader;`);
    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO grafana_reader;`);
    await queryRunner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana_reader;`);
    // So future migrations' new tables are auto-granted too, without a
    // follow-up migration every time the schema grows.
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO grafana_reader;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM grafana_reader;`);
    await queryRunner.query(`REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM grafana_reader;`);
    await queryRunner.query(`REVOKE USAGE ON SCHEMA public FROM grafana_reader;`);
    await queryRunner.query(`REVOKE CONNECT ON DATABASE gateway FROM grafana_reader;`);
    await queryRunner.query(`DROP ROLE IF EXISTS grafana_reader;`);
  }
}
