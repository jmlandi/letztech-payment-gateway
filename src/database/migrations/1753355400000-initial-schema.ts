import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1753355400000 implements MigrationInterface {
  name = 'InitialSchema1753355400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE stores (
        id VARCHAR(30) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        wake_store_header VARCHAR(255) UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE store_credentials (
        id VARCHAR(30) PRIMARY KEY,
        store_id VARCHAR(30) NOT NULL REFERENCES stores(id),
        api_key_hash VARCHAR(255) NOT NULL,
        hmac_secret_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE store_settings (
        id VARCHAR(30) PRIMARY KEY,
        store_id VARCHAR(30) NOT NULL UNIQUE REFERENCES stores(id),
        fraud_enabled BOOLEAN NOT NULL DEFAULT false,
        koin_private_key_encrypted TEXT,
        zoop_seller_id VARCHAR(255),
        enabled_methods TEXT[] NOT NULL DEFAULT ARRAY['pix','boleto','credit_card'],
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE payments (
        id VARCHAR(30) PRIMARY KEY,
        store_id VARCHAR(30) NOT NULL,
        external_ref VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'created',
        method VARCHAR(50) NOT NULL,
        amount INTEGER NOT NULL,
        currency CHAR(3) NOT NULL DEFAULT 'BRL',
        customer JSONB NOT NULL,
        items JSONB NOT NULL,
        metadata JSONB,
        fraud_fingerprint_id VARCHAR(255),
        pix_qr_code TEXT,
        pix_qr_code_url TEXT,
        pix_expires_at TIMESTAMPTZ,
        boleto_url TEXT,
        boleto_barcode TEXT,
        boleto_expires_at TIMESTAMPTZ,
        idempotency_key VARCHAR(255),
        wake_order_id VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(store_id, external_ref)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_payments_store_id ON payments(store_id)`);
    await queryRunner.query(`CREATE INDEX idx_payments_status ON payments(status)`);

    await queryRunner.query(`
      CREATE TABLE payment_events (
        id VARCHAR(30) PRIMARY KEY,
        payment_id VARCHAR(30) NOT NULL REFERENCES payments(id),
        store_id VARCHAR(30) NOT NULL,
        type VARCHAR(100) NOT NULL,
        from_status VARCHAR(50),
        to_status VARCHAR(50),
        actor VARCHAR(100),
        raw JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_payment_events_payment_id ON payment_events(payment_id)`);
    await queryRunner.query(`CREATE INDEX idx_payment_events_store_id ON payment_events(store_id)`);

    await queryRunner.query(`
      CREATE TABLE fraud_evaluations (
        id VARCHAR(30) PRIMARY KEY,
        payment_id VARCHAR(30) NOT NULL REFERENCES payments(id),
        store_id VARCHAR(30) NOT NULL,
        provider VARCHAR(50) NOT NULL,
        reference_id VARCHAR(255),
        evaluation_id VARCHAR(255),
        type VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL,
        score INTEGER,
        raw JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_fraud_evaluations_payment_id ON fraud_evaluations(payment_id)`);

    await queryRunner.query(`
      CREATE TABLE provider_charges (
        id VARCHAR(30) PRIMARY KEY,
        payment_id VARCHAR(30) NOT NULL REFERENCES payments(id),
        store_id VARCHAR(30) NOT NULL,
        provider VARCHAR(50) NOT NULL,
        provider_id VARCHAR(255),
        type VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL,
        amount INTEGER NOT NULL,
        raw JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_provider_charges_payment_id ON provider_charges(payment_id)`);

    await queryRunner.query(`
      CREATE TABLE outbox (
        id VARCHAR(30) PRIMARY KEY,
        event_type VARCHAR(100) NOT NULL,
        aggregate_id VARCHAR(30) NOT NULL,
        store_id VARCHAR(30) NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        published_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_outbox_published ON outbox(published_at) WHERE published_at IS NULL`);

    await queryRunner.query(`
      CREATE TABLE idempotency_keys (
        id VARCHAR(30) PRIMARY KEY,
        key_hash VARCHAR(255) NOT NULL,
        store_id VARCHAR(30) NOT NULL,
        request_hash VARCHAR(255) NOT NULL,
        response JSONB,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(store_id, key_hash)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at)`);

    await queryRunner.query(`
      CREATE TABLE webhook_endpoints (
        id VARCHAR(30) PRIMARY KEY,
        store_id VARCHAR(30) NOT NULL,
        url TEXT NOT NULL,
        secret_hash VARCHAR(255) NOT NULL,
        enabled_events TEXT[] NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_webhook_endpoints_store_id ON webhook_endpoints(store_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS webhook_endpoints`);
    await queryRunner.query(`DROP TABLE IF EXISTS idempotency_keys`);
    await queryRunner.query(`DROP TABLE IF EXISTS outbox`);
    await queryRunner.query(`DROP TABLE IF EXISTS provider_charges`);
    await queryRunner.query(`DROP TABLE IF EXISTS fraud_evaluations`);
    await queryRunner.query(`DROP TABLE IF EXISTS payment_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS payments`);
    await queryRunner.query(`DROP TABLE IF EXISTS store_settings`);
    await queryRunner.query(`DROP TABLE IF EXISTS store_credentials`);
    await queryRunner.query(`DROP TABLE IF EXISTS stores`);
  }
}
