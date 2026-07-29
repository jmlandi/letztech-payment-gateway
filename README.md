# LetzTech Payment Gateway

Payment gateway for Wake Commerce e-commerce stores. Orchestrates fraud analysis (Koin, optional) and payment processing (Zoop) for each connected store.

**Stack:** Node.js · TypeScript · NestJS · PostgreSQL · Redis · BullMQ · Docker Compose · Caddy

---

## Prerequisites

- Node.js 22+
- Docker + Docker Compose
- Sandbox credentials for [Zoop](https://docs.zoop.co) and optionally [Koin](https://api-docs.koin.com.br)

---

## Local development

### 1. Clone and install

```bash
git clone https://github.com/letztech/gateway.git
cd gateway
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the required values (see [Credentials](#credentials) below).

### 3. Start infrastructure

```bash
docker compose up -d postgres redis
```

### 4. Run migrations

```bash
npm run migration:run
```

### 5. Start the API

```bash
npm run start:dev
```

API available at `http://localhost:3000`.

To start the background worker in a separate terminal:

```bash
npm run start:dev:worker
```

### Health check

```
GET http://localhost:3000/healthz
```

---

## Credentials

All credentials go in `.env`. Never commit this file.

### Required

| Variable | Description | Where to get |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Local: `postgresql://gateway:gateway@localhost:5432/gateway` |
| `REDIS_URL` | Redis connection string | Local: `redis://localhost:6379` |
| `ENCRYPTION_KEY` | 32-byte hex key for encrypting per-store Koin credentials (AES-256-GCM) | `openssl rand -hex 32` |
| `ZOOP_MARKETPLACE_ID` | Your Zoop marketplace ID | [Zoop dashboard](https://docs.zoop.co) → Credenciais |
| `ZOOP_API_KEY` | Zoop secret key (server-side only, never exposed to the browser) | Same as above |
| `ADMIN_API_KEY` | Bearer key used by the LetzTech panel to call `/v1/` admin routes | Choose a strong random value |

### Optional

| Variable | Default | Description |
|---|---|---|
| `ZOOP_PUBLIC_KEY` | — | Zoop public key for client-side tokenization (used in checkout scripts) |
| `ZOOP_SANDBOX` | `true` | Set to `false` in production |
| `KOIN_SANDBOX` | `true` | Set to `false` in production |
| `PORT` | `3000` | HTTP port for the API |
| `LOG_LEVEL` | `debug` | `debug` / `info` / `warn` / `error` |
| `BASE_URL` | — | Public base URL of this service (e.g. `https://pay.letstech.com.br`) — used to build the Koin callback URL |

> **Note:** Koin credentials are stored per store in the database (encrypted with `ENCRYPTION_KEY`), not in `.env`. They are configured via `PATCH /v1/stores/:id/settings` after onboarding each store.

---

## Project structure

```
src/
├── main.ts                  # API entry point
├── worker.ts                # BullMQ worker entry point
├── app.module.ts            # Root module (API)
│
├── domain/
│   ├── interfaces/          # PaymentProvider, FraudProvider ports
│   └── state-machine/       # PaymentStatus enum + ALLOWED_TRANSITIONS
│
├── wake/                    # Wake Commerce connector
│   ├── wake.controller.ts   # POST /wake/* endpoints
│   └── wake.service.ts      # Orchestrates fraud → payment flow
│
├── payments/                # Core domain
│   ├── entities/            # payment, payment_event, fraud_evaluation, provider_charge
│   └── payments.service.ts  # State transitions (atomic, with outbox)
│
├── risk/
│   ├── adapters/koin/       # Koin fraud adapter + field mapping doc
│   └── adapters/noop/       # NoopFraudProvider (stores without fraud)
│
├── providers/
│   └── zoop/                # Zoop payment adapter (Pix, boleto, card)
│
├── webhooks/                # Incoming webhooks: POST /webhooks/zoop, /webhooks/koin
├── notifications/           # BullMQ processor: postbacks + store webhooks
├── outbox/                  # Cron relay: unpublished outbox → BullMQ
├── stores/                  # Multi-tenant management (store, credentials, settings)
├── idempotency/             # Idempotency key deduplication (48h TTL)
├── admin/                   # Internal API /v1/ for the LetzTech panel
│
├── common/
│   ├── filters/             # Global error format
│   ├── middleware/          # X-Trace-Id + one access log line per request
│   ├── context/             # AsyncLocalStorage trace context
│   └── utils/               # HMAC signing, constant-time compare, ID generation, PII masking, log redaction
│
└── database/
    ├── data-source.ts       # TypeORM CLI data source
    └── migrations/          # SQL migrations
```

---

## Observability

Every transaction is traceable end to end. A trace id (`X-Trace-Id`, also
returned on the response) is assigned per request and carried through
`AsyncLocalStorage`, so an inbound call and the Zoop calls it triggers share
one id in the logs.

Logs are structured JSON (pino, via `nestjs-pino`), one object per line,
shipped to Loki by Promtail (see "Risk review, logs and metrics" below). A
pino `mixin` stamps `traceId` onto every line — including logs deep in a
service that never sees the request — so `traceId=<id>` in your log tool
returns the whole story of one transaction.
`LOG_LEVEL` overrides the default (`info` in production, `debug` elsewhere);
outside production output is pretty-printed instead.

```json
{"level":30,"traceId":"01KYM…","context":"PaymentsService","paymentId":"pay_01","status":"captured","msg":"Payment state transition"}
```

| Log | Emitted by | Carries |
|---|---|---|
| `Request handled` | `requestLoggingMiddleware` | traceId, method, path, status, durationMs, caller IP, redacted query |
| `Zoop request sent` | `ZoopPaymentAdapter` | traceId, operation, referenceId, path, redacted payload, card-token fingerprint |
| `Zoop response received` | `ZoopPaymentAdapter` | traceId, status, durationMs, Zoop transaction id and status |
| `Zoop call refused` (warn) | `ZoopPaymentAdapter` | 4xx from Zoop — declined card, bad seller |
| `Zoop call failed` (error) | `ZoopPaymentAdapter` | 5xx/timeout/transport failure, with `code` (e.g. `ECONNABORTED`) |
| `Fraud evaluation recorded` | `PaymentsService` | provider, status, score, paymentId |
| `Payment state transition` | `PaymentsService` | from/to status, actor |
| `Zoop/Koin webhook received` | `WebhooksController` | event id, type, transaction id |

Correlation keys: `traceId` ties one inbound request to its provider calls;
`referenceId` on a Zoop log line **is** the internal payment id.

The access log is middleware, not an interceptor, so requests rejected by a
guard (bad `ADMIN_API_KEY`, unsigned WooCommerce call) are logged too.

Successful `/healthz` probes are not logged (Docker polls every 15s on two
containers); a failing probe still is.

**Redaction.** Nothing reaches a log unfiltered, in two layers:

1. `common/utils/redact.ts` scrubs credentials (ZPK, `x-api-key`, mTLS
   material), card data (PAN, CVV, token ids) and PII (taxpayer id, e-mail,
   phone) plus payable codes (PIX EMV, boleto barcode) at arbitrary depth, and
   bounds depth/size. Card tokens appear only as a non-chargeable last-4
   fingerprint.
2. pino's own `redact` paths act as a safety net for a log line added later
   that forgets step 1. Note pino's `*` spans exactly one level, so each key is
   listed both at the root and one level down.

Tests assert that no credential, card token or PII appears anywhere in the
emitted log lines.

---

## Risk review, logs and metrics (Grafana)

Fraud/risk review, log search and request/infra metrics all live behind one
Grafana instance — not a bespoke admin page or endpoint. Grafana is
**SSH-tunnel-only**, never exposed via Caddy:

```
ssh -L 3001:localhost:3001 useradm@<vps-host>
```

then open `http://localhost:3001` (credentials in the VPS's `.env`,
`GRAFANA_ADMIN_PASSWORD`).

- **Dashboards → Risk Review** — two panels replicating the old risk-review
  UI: "Declined Attempts / Card Testing" (reads `payments` directly, so it
  has data even for stores with `fraudEnabled: false` — the WooCommerce
  auto-provisioned default) and "Risk Evaluations" (reads `fraud_evaluations`
  joined with `payments`, only populated for stores with fraud checks on).
  Filterable by store, time range, status, method and thresholds via
  dashboard variables.
- **Explore** — ad hoc SQL against the read-only `Postgres` datasource
  (role `grafana_reader`, `SELECT`-only, created by the
  `AddGrafanaReaderRole` migration), or LogQL against `Loki` for searching
  logs by `traceId`/`level`/`container` across deploys (previously lost on
  every container recycle — logs only went to stdout).
- **Metrics** — `Prometheus` scrapes the app's `/metrics` (request
  duration/count by route and status — blocked from the public internet in
  `caddy/Caddyfile`, only reachable over the internal docker network) and
  `node-exporter` (host CPU/mem/disk). cAdvisor (per-container metrics) is
  disabled by default — see the comment on its service in
  `docker-compose.yml` if re-enabling it on a different host.

New services aren't part of the CI/CD deploy script's `up -d app worker` —
brought up once manually (`docker compose up -d loki promtail prometheus
node-exporter grafana`) and left running via `restart: unless-stopped`.
Config-file-only edits (the `loki/`, `promtail/`, `prometheus/`,
`grafana/provisioning/` YAML) need a manual `docker compose up -d <service>`
afterwards to take effect — a `git pull` alone doesn't reload a bind-mounted
config file, the same reason Caddy's deploy step has an explicit `caddy
reload` line.

---

## Available scripts

| Script | Description |
|---|---|
| `npm run start:dev` | Start API with hot reload (ts-node) |
| `npm run start:dev:worker` | Start worker with hot reload |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled API (`node dist/main.js`) |
| `npm run start:worker` | Run compiled worker (`node dist/worker.js`) |
| `npm run migration:run` | Apply pending migrations |
| `npm run migration:generate -- src/database/migrations/<Name>` | Generate migration from entity changes |
| `npm run migration:revert` | Revert last migration |
| `npm test` | Run unit tests |

---

## Docker (full stack)

```bash
# Start everything (Caddy + API + worker + Postgres + Redis)
docker compose up -d

# View logs
docker compose logs -f app
docker compose logs -f worker

# Run migrations inside the container
docker compose exec app node dist/database/migrations/... # or use migration:run locally
```

The compose file uses two separate containers from the same image:
- `app` → `node dist/main.js` (HTTP API)
- `worker` → `node dist/worker.js` (BullMQ processors + outbox relay)

---

## Key design decisions

1. **Card data never touches our infrastructure in plaintext.** Tokenization happens in the buyer's browser using the Zoop public key; the backend only handles tokens.
2. **All mutations are idempotent.** Double-clicks, network retries, and webhook replays never create duplicate charges.
3. **Transactional outbox.** Every state transition and its corresponding event are written in the same SQL transaction — no dual-write risk.
4. **Fraud is optional per store.** Stores without Koin receive `NoopFraudProvider`; the payment flow has no `if (koin)` anywhere.
5. **Providers are adapters.** The domain only knows `PaymentProvider` and `FraudProvider` interfaces — swapping Zoop or Koin is one new adapter.

---

## External integrations

| Service | Role | Docs |
|---|---|---|
| **Wake Commerce** | E-commerce platform (connector) | `wakecommerce.readme.io` |
| **Zoop** | Payment processor (Pix, boleto, card) | `docs.zoop.co` |
| **Koin** | Fraud detection (optional per store) | `api-docs.koin.com.br` |

---

## Contact

Dúvidas ou eventualidades: Marcos Landi — [contato@marcoslandi.com](mailto:contato@marcoslandi.com)
