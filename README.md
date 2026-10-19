
# Usage Metering and Quota Service

A multi-tenant backend service that tracks resource consumption and enforces monthly quotas for companies and their users.

Built with **TypeScript, Express, PostgreSQL, Drizzle ORM, React, and Docker**.

Each company and user has a subscription plan. Before accepting a usage request, the service checks both sets of limits, records the decision, and updates consumption only when the request is allowed.

## Tech Stack

- **Backend:** Node.js, TypeScript, Express 5, Zod
- **Database:** PostgreSQL 17, Drizzle ORM
- **Frontend:** React, Vite, TypeScript, Nginx
- **DevOps:** Docker, Docker Compose
- **Testing:** Vitest, Supertest, Autocannon

## Quick Start

**Requirements:** Docker, Docker Compose, Git, and available ports 3000, 8080, and 5433.

### 1. Clone the repository

```bash
git clone https://github.com/ellen-izz/usage-metering.git
cd usage-metering
```

### 2. Configure the database

```bash
cp .env.docker.example .env.docker
```

Edit `.env.docker` and replace the placeholder `POSTGRES_PASSWORD` with a secure password.

### 3. Start the application

```bash
docker compose --env-file .env.docker up --build -d
```

Compose builds the frontend and backend, starts PostgreSQL, applies migrations, and seeds the predefined plans.

Verify:

```bash
docker compose --env-file .env.docker ps -a
curl http://localhost:8080/api/healthz
```

Expected: `db` healthy, `init` exited (0), `api` and `client` running, and the health endpoint returning `OK`.

### 4. Create a demo company

```bash
curl -X POST http://localhost:8080/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"DemoCompany","planName":"Starter"}'
```

The response contains a unique API key. **Save it securely; it is shown only once.**

### 5. Open the dashboard

Visit **http://localhost:3000**, enter the new API key, and click **Connect**.

You can now create users, submit usage requests, change plans, inspect quotas, and view request history.

To stop the application while preserving database data:

```bash
docker compose --env-file .env.docker down
```

Do not use `down -v` unless you intend to delete the PostgreSQL volume.

## Features

- API-key authentication and account isolation
- Predefined and custom company/user plans
- Configurable monthly allowances and per-request limits
- Plan switching without resetting consumption
- Safe retries using idempotency keys
- Atomic quota enforcement using transactions and row locks
- UTC monthly usage tracking and historical queries
- Paginated accepted/rejected request history
- Interactive React dashboard
- Dockerized deployment and automated tests

## Architecture

```text
Browser
   |
React + Nginx (:3000)
   |
Express REST API (:8080)
   |
Drizzle ORM
   |
PostgreSQL (persistent volume)
```

Docker Compose runs four services: `db`, `init`, `api`, and `client`.

The database contains seven tables:

`accounts`, `users`, `account_plans`, `user_plans`, `account_usage_counters`, `user_usage_counters`, and `usage_requests`.

Company usage is shared across its users, while each user maintains independent consumption.

## Subscription Plans

| Level | Plan | Monthly Limit | Max/Request |
|---|---|---:|---:|
| Company | Starter | 10,000 | 1,000 |
| Company | Pro | 100,000 | 10,000 |
| User | Basic | 1,000 | 100 |
| User | Premium | 10,000 | 1,000 |

Both company and user limits must permit a request.

Companies can create, update, and assign their own custom plans. Built-in plans are read-only.

## API Reference

Protected endpoints require:

```http
Authorization: ApiKey YOUR_API_KEY
```

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/accounts` | Create company and API key |
| GET | `/api/account` | Get authenticated account |
| GET/POST | `/api/users` | List/create users |
| GET | `/api/plans` | List available plans |
| POST | `/api/plans/account` | Create custom company plan |
| POST | `/api/plans/user` | Create custom user plan |
| PATCH | `/api/plans/account/:id` | Update custom company plan |
| PATCH | `/api/plans/user/:id` | Update custom user plan |
| PATCH | `/api/account/plan` | Switch company plan |
| PATCH | `/api/users/:id/plan` | Switch user plan |
| POST | `/api/usage` | Process usage request |
| GET | `/api/account/usage` | Company usage |
| GET | `/api/users/:id/usage` | User usage |
| GET | `/api/account/history` | Company request history |
| GET | `/api/users/:id/history` | User request history |

Usage and history endpoints accept an optional `month=YYYY-MM`. History supports `limit` and `offset` pagination.

### Example: Create a user

Enter the API key without displaying it:

```bash
read -rsp "API key: " API_KEY
echo
```

Create a Basic user:

```bash
curl -X POST http://localhost:8080/api/users \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","planName":"Basic"}'
```

Save the returned user UUID.

### Example: Submit usage

```bash
USER_ID="PASTE_USER_UUID_HERE"

curl -X POST http://localhost:8080/api/usage \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(cat /proc/sys/kernel/random/uuid)" \
  -d "{\"userId\":\"$USER_ID\",\"units\":10}"
```

Accepted requests return `allowed: true`. Rejected requests return `allowed: false` and a reason.

Use a new idempotency key for each new operation. Reuse the same key when retrying the same operation.

To assign a plan, send its UUID as `{"planId":"PLAN_UUID"}` to the appropriate PATCH endpoint.

## Demonstration Guide

Use a fresh demo company so the results are predictable.

| Scenario | Action | Expected result |
|---|---|---|
| Different users | Create Alice (Basic) and Bob (Premium) | Independent user quotas, shared company quota |
| Accepted request | Alice consumes 10 units | Accepted; both counters increase by 10 |
| User request limit | Alice requests 101 units | `user_max_units_per_request_exceeded` |
| User downgrade | Bob consumes 1,500 units in valid requests, then switches to Basic | 1,500 used remains, 0 remaining |
| User monthly rejection | Bob requests another 10 units | `user_monthly_quota_exceeded` |
| Company limit | Assign a custom company plan with allowance below the next requested total | `account_monthly_quota_exceeded` |
| Plan upgrade | Switch company to Pro | Higher allowance; consumption preserved |
| History | Open dashboard request history | Accepted and rejected decisions with reasons |

For a controlled company-limit demonstration, after the company has consumed 2,000 units, create a custom plan:

```bash
curl -X POST http://localhost:8080/api/plans/account \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"QuotaDemoPlan","monthlyAllowance":2001,"maxUnitsPerRequest":1000}'
```

Assign its returned plan UUID through the dashboard. A request for 10 units from a user with sufficient individual quota should be rejected because the company has only 1 unit remaining.

Creating and updating custom plans is done through the REST API. The dashboard supports changing company and user plan assignments.

## Rules and Design Decisions

- **Resource:** One generic resource measured in positive integer units.
- **Monthly periods:** UTC calendar months; previous months remain queryable.
- **Consumption:** All-or-nothing; rejected requests consume zero units.
- **Combined rules:** Both account and user plans must allow a request.
- **Plan changes:** New limits apply without resetting existing consumption.
- **Downgrades:** Remaining allowance is floored at zero if usage exceeds the new limit.
- **Custom plans:** Owned by one account; built-in plans cannot be edited.
- **Decision priority:** Account request limit, user request limit, account monthly limit, then user monthly limit.
- **Idempotency:** Keys are scoped per account. Identical retries reuse the recorded decision; conflicting payloads return HTTP 409.

Quota processing runs in PostgreSQL transactions with row-level locks to prevent concurrent requests from overspending quotas. Plan assignments also coordinate using the account lock.

A tradeoff is that heavy write activity against one company may be serialized and incur higher latency.

## Testing

The project includes **28 automated tests across 5 files**, covering authentication, isolation, quotas, custom plans, concurrency, idempotency, and history.

Tests require Node.js, npm, and a configured PostgreSQL database. Use an isolated development/test database because integration tests write data.

```bash
npm ci
npm test
npx tsc --noEmit
```

Frontend production build:

```bash
cd client
npm ci
npm run build
```
## Database Migrations (Development)

The project uses Drizzle ORM to manage the PostgreSQL schema.

Database schema definitions are located in `src/db/schema.ts`.

After modifying the schema, generate a new migration from the project root:

```bash
npx drizzle-kit generate
```

Apply the migration:

```bash
npx drizzle-kit migrate
```

Ensure the database is running and the local database connection is configured before running the migration.

**Note:** Normal Docker deployment automatically applies existing migrations through the `init` service. Reviewers do not need to run these commands separately.

## Performance Results

Local benchmarks against the Docker-hosted API:

| Operation | Throughput | p99 Latency |
|---|---:|---:|
| Health check GET | 2,939.54 req/s | 14 ms |
| Authenticated usage GET | 298.54 req/s | 69 ms |
| Usage POST, 10 workers | 23.45 req/s | 566 ms |

The write benchmark processed **250 accepted requests with 0 errors** in 10.66 seconds. All writes targeted one account, creating lock contention.


Reproduce read benchmarks with Autocannon:

```bash
npx --yes autocannon -c 10 -d 15 http://localhost:8080/api/healthz

npx --yes autocannon -c 10 -d 15 \
  -H "Authorization: ApiKey $API_KEY" \
  http://localhost:8080/api/account/usage
```

Reproduce the write benchmark:

```bash
ALLOW_USAGE_BENCHMARK=yes node benchmarks/usage-benchmark.mjs
```

**Warning:** The write benchmark creates an account and usage records without automatically deleting them. Run it only against an isolated test database and clean up afterward.

Measurements are environment-specific and not production throughput guarantees.

### Multi-Company Performance Comparison

To investigate database lock contention, usage-write performance was tested under two scenarios with 250 requests and 10 concurrent workers.

| Scenario | Throughput | Average Latency | Errors |
|---|---:|---:|---:|
| 1 company, 10 workers | 23.45 req/s | 422.20 ms | 0 |
| 10 companies, 10 workers | 57.58 req/s | 176.76 ms | 0 |

The multi-company result is the average of three runs using the default Postgres.js connection pool of 10 connections.

**Observation:** Distributing requests across companies improved throughput because requests did not all contend for the same company row lock. Performance still varied across runs.

To reproduce the multi-company benchmark:

```bash
ALLOW_USAGE_BENCHMARK=yes node benchmarks/multi-account-benchmark.mjs
```

Run benchmarks only against an isolated development or test database. The script creates 10 companies and 250 usage records per run and does not automatically delete them.

These results are environment-specific and are not production performance guarantees.

## Security and Limitations

- API keys are stored as SHA-256 hashes and returned only at creation.
- API operations are scoped to the authenticated company.
- The React dashboard accepts an API key directly for local demonstration only.
- Production use would require stronger dashboard authentication, HTTPS, key rotation, rate limiting, and monitoring.
- Custom-plan editing is API-only; the dashboard focuses on demonstration.
- Integration tests require isolated database infrastructure.
- Plan-definition updates during concurrent usage may require additional synchronization testing.
- Payments, refunds, multiple resource types, and end-user login are outside the project scope.

## License

ISC
