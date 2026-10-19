
# Usage Metering and Quota Service

A multi-tenant usage metering and quota enforcement system built with TypeScript, Express, PostgreSQL, Drizzle ORM, React, and Docker.

The service allows multiple companies to manage their users, subscription plans, monthly usage limits, and usage history.

## Features

- API-key authentication for companies
- Multi-tenant account isolation
- Account-level and user-level quotas
- Starter and Pro account plans
- Basic and Premium user plans
- Custom subscription plan management
- Monthly usage tracking
- Idempotent usage requests
- Database transactions and row-level locking
- Accepted and rejected usage history
- Paginated history endpoints
- React administration dashboard
- Docker Compose deployment
- Automated integration tests
- Performance benchmarking

## Technology Stack

### Backend
- Node.js
- TypeScript
- Express 5
- PostgreSQL 17
- Drizzle ORM
- Zod

### Frontend
- React
- TypeScript
- Vite
- Nginx

### DevOps and Testing
- Docker
- Docker Compose
- Vitest
- Supertest
- Git and GitHub

## Architecture

Browser
  |
  v
React Dashboard (Nginx, port 3000)
  |
  | HTTP /api requests
  v
Express REST API (port 8080)
  |
  | Drizzle ORM / SQL
  v
PostgreSQL Database (Docker volume)

Docker Compose manages the database, initialization, API, and frontend services.

## Database Design

The database contains seven main tables:

- accounts
- users
- account_plans
- user_plans
- account_usage_counters
- user_usage_counters
- usage_requests

Each user belongs to one account.

Accounts and users have subscription plans that define monthly allowances and maximum units per request.

Usage counters track consumption by UTC calendar month.

Usage requests record accepted and rejected decisions.

## Default Subscription Plans

| Plan | Monthly allowance | Maximum per request |
|------|-------------------|---------------------|
| Starter (account) | 10,000 | 1,000 |
| Pro (account) | 100,000 | 10,000 |
| Basic (user) | 1,000 | 100 |
| Premium (user) | 10,000 | 1,000 |

## Authentication

Each company receives a unique API key when its account is created.

Requests to protected endpoints must include:

Authorization: ApiKey YOUR_API_KEY

The database stores the SHA-256 hash of the API key rather than the original secret.

The original key is displayed only during account creation and must be stored securely.

## Running with Docker

### 1. Clone the repository

git clone https://github.com/ellen-izz/usage-metering.git

cd usage-metering

### 2. Configure the database password

Copy the example environment file:

cp .env.docker.example .env.docker

Edit .env.docker and replace the placeholder with a secure random password.

For example, generate a password using:

openssl rand -hex 32

Do not commit .env.docker.

### 3. Build the Docker images

docker build -t usage-metering-api:1.0 .

docker build -t usage-metering-client:1.0 ./client

### 4. Start the services

docker compose --env-file .env.docker up -d

### 5. Verify the services

docker compose --env-file .env.docker ps -a

The database should be healthy, the API and client should be running, and the initialization service should exit successfully.

### 6. Open the dashboard

http://localhost:3000

The API is available at:

http://localhost:8080

### 7. Stop the application

docker compose --env-file .env.docker down

Do not use `down -v` unless you intentionally want to remove the persistent PostgreSQL data.

## Creating an Account

Send a request to:

POST /api/accounts

Example:

curl -X POST http://localhost:8080/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"ExampleCompany","planName":"Starter"}'

The response contains the new account ID and API key.

Save the API key securely.

## Main API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/accounts | Create a company |
| GET | /api/account | Retrieve authenticated account |
| GET | /api/account/usage | Retrieve company quota |
| GET | /api/account/history | Retrieve company usage history |
| POST | /api/users | Create a user |
| GET | /api/users | List company users |
| GET | /api/users/:id/usage | Retrieve individual user quota |
| GET | /api/users/:id/history | Retrieve individual usage history |
| POST | /api/usage | Process a usage request |

Additional endpoints support custom plan creation, modification, and subscription changes.

## Submitting Usage

Example request:

POST /api/usage

Headers:

Authorization: ApiKey YOUR_API_KEY
Content-Type: application/json
Idempotency-Key: UNIQUE_REQUEST_ID

JSON body:

{
  "userId": "USER_UUID",
  "units": 10
}

The service authenticates the account, verifies user ownership, checks quotas, and records the decision.

Accepted requests increase both user and account usage counters.

Rejected requests are recorded but do not consume quota.

## Idempotency

Each logical usage request must have a unique idempotency key.

Replaying the same request with the same key prevents duplicate quota consumption.

Reusing the same key with a different request payload produces a conflict response.

## Concurrency Control

Quota enforcement uses PostgreSQL transactions and row-level locks.

This prevents simultaneous requests from independently approving usage against the same remaining quota.

The account and user counters are updated atomically for accepted requests.

## Frontend Dashboard

The React dashboard supports:

- Company API-key connection
- Company quota overview
- Monthly usage progress
- Creating users
- Selecting existing users
- Submitting usage requests
- Viewing individual user quotas
- Automatic quota refresh
- Paginated usage history

The Vite development server can be started using:

cd client

npm install

npm run dev

Development URL: http://localhost:5173

The Docker-hosted frontend runs at http://localhost:3000.

## Automated Testing

Install the backend dependencies:

npm ci

Configure a PostgreSQL database for testing.

Run:

npm test

The project currently has 28 passing tests across five files.

Tests cover authentication, usage enforcement, concurrency, idempotency, plans, history, pagination, and user isolation.

Note: Integration tests operate on the configured PostgreSQL database. Use an isolated testing database instead of production data.

## Performance Benchmarking

Benchmarks were performed locally against the Docker-hosted API.

### Read-only HTTP benchmarks

Both tests used 10 concurrent connections over 15 seconds.

| Endpoint | Average requests/sec | Median latency | p99 latency |
|----------|----------------------|----------------|-------------|
| GET /api/healthz | 2,939.54 | 2 ms | 14 ms |
| GET /api/account/usage | 298.54 | 31 ms | 69 ms |

A separate five-second authenticated account-usage benchmark processed 1,091 requests, all returning HTTP 200.

### Usage write benchmark

A custom benchmark sent 250 usage requests using 10 concurrent workers against one disposable company and user.

| Metric | Result |
|--------|--------|
| Total requests | 250 |
| Accepted | 250 |
| Rejected | 0 |
| Errors | 0 |
| Duration | 10.66 seconds |
| Throughput | 23.45 requests/sec |
| Average latency | 422.20 ms |
| p50 latency | 458.70 ms |
| p95 latency | 513.96 ms |
| p99 latency | 566.00 ms |

Run the write benchmark using:

ALLOW_USAGE_BENCHMARK=yes node benchmarks/usage-benchmark.mjs

The benchmark requires ALLOW_USAGE_BENCHMARK=yes to prevent accidental execution. It creates a temporary company, user, and usage records in the configured database. These records are not automatically deleted. Run it only against an isolated development or test database, and clean up the generated data afterward.

WARNING: The benchmark creates a new account, user, and usage records in the configured database. It does not automatically clean up after execution. Run it only in an isolated development or testing environment.

These benchmarks are local measurements and do not represent guaranteed production throughput.

## Security Considerations

- API keys are stored as hashes.
- API requests are authenticated and scoped to the requesting account.
- Usage requests validate their inputs using Zod.
- Idempotency prevents accidental duplicate consumption.
- Database transactions protect quota consistency.
- Environment files containing secrets are excluded from version control.
- The current browser dashboard uses manual API-key entry for local demonstrations.

For production, additional protections are recommended, including dashboard sessions, secure key rotation, rate limiting, HTTPS, stronger operational monitoring, and isolated test infrastructure.

## License

ISC
