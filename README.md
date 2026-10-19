
# Usage Metering and Quota Service

A multi-tenant backend service that allows applications to track resource consumption and decide whether a user may consume additional units.

The system enforces both **company-wide and individual user limits**, records accepted and rejected requests, and provides a React dashboard for monitoring and managing usage.

## Technology Stack

| Component | Technology |
| --- | --- |
| Backend | Node.js, TypeScript, Express 5 |
| Database | PostgreSQL 17 |
| ORM | Drizzle ORM |
| Validation | Zod |
| Frontend | React, TypeScript, Vite |
| Web Server | Nginx |
| Containerization | Docker and Docker Compose |
| Testing | Vitest and Supertest |
| Performance Testing | Autocannon and Node.js |

## Features

- API-key authentication for companies
- Multi-tenant account isolation
- Company-level and user-level subscription plans
- Predefined Starter, Pro, Basic, and Premium plans
- Custom subscription plan creation and modification
- Company and user plan switching without restarting the service
- Monthly UTC usage tracking
- Maximum units per request
- Atomic, all-or-nothing usage decisions
- Idempotency keys for safe retries
- PostgreSQL transactions and row-level locking
- Accurate quota enforcement under concurrent requests
- Accepted and rejected usage history
- Historical-month queries
- Paginated history endpoints
- React dashboard for quota monitoring and plan management
- Docker Compose deployment with automatic initialization
- Automated integration tests
- Performance benchmarks

## Architecture

```text
                   Browser
                      |
                      v
             React Dashboard
              Nginx Port 3000
                      |
                      | HTTP /api
                      v
              Express REST API
                Port 8080
                      |
                      | Drizzle ORM
                      v
               PostgreSQL 17
                Port 5432
                      |
                      v
             Persistent Volume
```

The application uses four Docker Compose services:

| Service | Description |
| --- | --- |
| `db` | PostgreSQL database with persistent storage |
| `init` | Runs database migrations and seeds predefined plans |
| `api` | Express backend responsible for authentication, business rules, and database operations |
| `client` | Nginx serves the compiled React application and proxies API requests |

The API and initialization services share the same backend Docker image.

## Database Design

The database contains seven main tables.

| Table | Purpose |
| --- | --- |
| `accounts` | Stores companies, account-plan assignments, and hashed API keys |
| `users` | Stores users belonging to companies and their plan assignments |
| `account_plans` | Defines built-in and custom company subscription plans |
| `user_plans` | Defines built-in and custom user subscription plans |
| `account_usage_counters` | Tracks company consumption for each UTC month |
| `user_usage_counters` | Tracks individual user consumption for each UTC month |
| `usage_requests` | Stores usage decisions, request identifiers, and rejection reasons |

### Relationships

- Each user belongs to one account.
- Each account has one assigned account plan.
- Each user has one assigned user plan.
- Several users may share the same plan definition.
- Users sharing a plan maintain independent usage counters.
- Company usage represents the combined accepted consumption of its users.
- Each usage request belongs to an authenticated account and a registered user.

When a usage request is accepted, both the account counter and the relevant user counter increase by the requested units.

Rejected requests do not increase either counter.

## Default Subscription Plans

### Company Plans

| Plan | Monthly Allowance | Maximum Per Request |
| --- | ---: | ---: |
| Starter | 10,000 | 1,000 |
| Pro | 100,000 | 10,000 |

### User Plans

| Plan | Monthly Allowance | Maximum Per Request |
| --- | ---: | ---: |
| Basic | 1,000 | 100 |
| Premium | 10,000 | 1,000 |

Both the company plan and the user plan must allow a request before units can be consumed.

For example, if a Premium user has 5,000 units remaining but their company has only 5 units remaining, a request for 10 units will be rejected.

An account may also create custom plans, update its own custom plan definitions, and assign eligible plans through the API.

Built-in plans are read-only.

## Requirements

To run the application, install:

- Docker Engine or Docker Desktop
- Docker Compose
- Git
- A modern web browser

Ensure ports `3000`, `8080`, and `5433` are available.

For local development and automated tests, Node.js and npm are also required.

## Running with Docker

### 1. Clone the Repository

```bash
git clone https://github.com/ellen-izz/usage-metering.git
cd usage-metering
```

### 2. Configure the Database Password

Copy the example environment file:

```bash
cp .env.docker.example .env.docker
```

Open `.env.docker` and replace the placeholder password with a strong password.

Generate a password using:

```bash
openssl rand -hex 32
```

Keep `.env.docker` private and do not commit it to GitHub.

### 3. Build and Start the Application

Run:

```bash
docker compose --env-file .env.docker up --build -d
```

Docker Compose automatically:

1. Builds the backend Docker image.
2. Builds the React frontend Docker image.
3. Starts PostgreSQL.
4. Waits for PostgreSQL to become healthy.
5. Runs database migrations.
6. Seeds predefined account and user plans.
7. Starts the Express API.
8. Starts the React dashboard.

No separate `docker build` commands are required.

The `--env-file` option is necessary because the database password is stored in `.env.docker` instead of Docker Compose's default `.env` file.

### 4. Verify Container Status

```bash
docker compose --env-file .env.docker ps -a
```

Expected results:

| Service | Expected Status |
| --- | --- |
| `db` | Running (healthy) |
| `init` | Exited (0) |
| `api` | Running |
| `client` | Running |

Verify the API:

```bash
curl -f http://localhost:8080/api/healthz
```

### 5. Open the Dashboard

React dashboard:

http://localhost:3000

Backend API:

http://localhost:8080

Create a company through the API, save its API key, and enter the key in the dashboard to connect.

### 6. Stop the Application

```bash
docker compose --env-file .env.docker down
```

This stops and removes the containers while preserving the PostgreSQL volume.

**Do not use `docker compose down -v` unless you intentionally want to delete the stored database data.**

## Authentication

Every company receives a unique API key when its account is created.

The API key identifies the company and limits access to that company's users, plans, and usage records.

Protected requests require:

```http
Authorization: ApiKey YOUR_API_KEY
```

The backend stores the SHA-256 hash of the API key rather than the original key.

The original key is returned only when the account is created.

Missing or invalid credentials are rejected.

### Create a Company

```bash
curl -X POST http://localhost:8080/api/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ExampleCompany",
    "planName": "Starter"
  }'
```

The response contains the created account and its API key.

**Save the API key securely. It will not be returned again.**

For subsequent examples, enter the key without displaying it:

```bash
read -rsp "Enter API key: " API_KEY
echo
```

### Create a User

```bash
curl -X POST http://localhost:8080/api/users \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice",
    "planName": "Basic"
  }'
```

The response includes the created user's UUID.

List users:

```bash
curl http://localhost:8080/api/users \
  -H "Authorization: ApiKey $API_KEY"
```

Store the selected user UUID for later commands:

```bash
read -rp "User UUID: " USER_ID
```

## Main API Endpoints

All endpoints are relative to `http://localhost:8080`.

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/api/healthz` | Check service health |
| POST | `/api/accounts` | Create an account and issue an API key |
| GET | `/api/account` | Identify the authenticated account |
| GET | `/api/users` | List company users |
| POST | `/api/users` | Register a user |
| GET | `/api/plans` | List available subscription plans |
| POST | `/api/plans/account` | Create a custom company plan |
| POST | `/api/plans/user` | Create a custom user plan |
| PATCH | `/api/plans/account/:id` | Update a custom company plan |
| PATCH | `/api/plans/user/:id` | Update a custom user plan |
| PATCH | `/api/account/plan` | Change the company's assigned plan |
| PATCH | `/api/users/:id/plan` | Change a user's assigned plan |
| POST | `/api/usage` | Submit and evaluate a usage request |
| GET | `/api/account/usage` | Get company usage and remaining allowance |
| GET | `/api/users/:id/usage` | Get individual user usage |
| GET | `/api/account/history` | Get company request history |
| GET | `/api/users/:id/history` | Get individual user request history |

Except for account creation and health checking, account-related endpoints require a valid API key.

## Custom Plans

Companies can create custom subscription plans through the REST API.

### Create a Custom Company Plan

```bash
curl -X POST http://localhost:8080/api/plans/account \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "SmallDemo",
    "monthlyAllowance": 2001,
    "maxUnitsPerRequest": 1000
  }'
```

### Create a Custom User Plan

```bash
curl -X POST http://localhost:8080/api/plans/user \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Student",
    "monthlyAllowance": 500,
    "maxUnitsPerRequest": 50
  }'
```

### Update a Custom Plan

Use:

```http
PATCH /api/plans/account/:id
```

Or:

```http
PATCH /api/plans/user/:id
```

Supply the plan's name, monthly allowance, and maximum units per request.

Only the owner can modify a custom plan.

### Assign a Company Plan

```http
PATCH /api/account/plan
```

Request body:

```json
{
  "planId": "PLAN_UUID"
}
```

### Assign a User Plan

```http
PATCH /api/users/:id/plan
```

Request body:

```json
{
  "planId": "PLAN_UUID"
}
```

Plan changes take effect without redeploying the application.

Previously consumed units are preserved when a plan changes.

## Usage Requests

Usage is measured in generic consumption units, such as document-processing credits.

### Submit Usage

```bash
curl -X POST http://localhost:8080/api/usage \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(cat /proc/sys/kernel/random/uuid)" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"units\": 10
  }"
```

Each new logical request requires a unique idempotency key.

The backend:

1. Authenticates the company.
2. Validates the request.
3. Confirms the user belongs to that company.
4. Retrieves the currently assigned account and user plans.
5. Checks maximum units per request.
6. Checks remaining monthly quotas.
7. Records the decision.
8. Updates both usage counters if accepted.

### Acceptance and Rejection

Accepted requests return:

```json
{
  "allowed": true,
  "reason": null,
  "duplicate": false
}
```

The actual response also includes request information and usage figures.

Rejected requests return `allowed: false` with a reason identifying the limiting rule.

Supported reasons include:

| Reason | Meaning |
| --- | --- |
| `account_max_units_per_request_exceeded` | Requested units exceed the company's per-request maximum |
| `user_max_units_per_request_exceeded` | Requested units exceed the user's per-request maximum |
| `account_monthly_quota_exceeded` | Company monthly allowance is insufficient |
| `user_monthly_quota_exceeded` | User monthly allowance is insufficient |

Business-rule rejections return an HTTP 200 response with `allowed: false`.

Rejected requests are recorded in history but do not consume quota.

## Idempotency

Idempotency prevents a logical request from consuming units multiple times if the caller retries it.

Each logical usage operation includes an `Idempotency-Key` HTTP header.

Rules:

- A new operation uses a new key.
- Retrying the same operation reuses the same key.
- Retrying the same operation does not increase consumption again.
- Reusing a key with a different user or unit amount produces HTTP 409.
- Idempotency keys are scoped to the authenticated account.

For example, if a request consuming 10 units succeeds but the caller does not receive the response, it can retry with the original idempotency key.

The backend returns the stored decision without charging another 10 units.

## Monthly Usage and History

Usage is tracked by UTC calendar month.

Each new month has independent usage counters, while previous months remain available for querying.

### Current Company Usage

```bash
curl http://localhost:8080/api/account/usage \
  -H "Authorization: ApiKey $API_KEY"
```

### Current User Usage

```bash
curl "http://localhost:8080/api/users/$USER_ID/usage" \
  -H "Authorization: ApiKey $API_KEY"
```

### Previous Month

The optional `month` parameter uses `YYYY-MM`.

Examples:

```http
GET /api/account/usage?month=2026-09
GET /api/users/USER_UUID/usage?month=2026-09
```

### Request History

```http
GET /api/account/history?month=2026-10&limit=10&offset=0
```

Individual user history:

```http
GET /api/users/USER_UUID/history?month=2026-10&limit=10&offset=0
```

History supports pagination using:

- `limit`: number of records, from 1 to 100
- `offset`: number of records to skip
- `month`: optional UTC month

The default page size is 10.

History contains both accepted and rejected requests.

## React Dashboard

The React dashboard provides a working example client for interacting with the service.

Open:

http://localhost:3000

Available features:

- Connect to a company using its API key
- Display the current company plan
- Show company monthly allowance, consumption, and remaining units
- Display a quota progress bar
- View available company and user plans
- Create users with Basic or Premium subscriptions
- View registered users
- View individual user plan details and usage
- Change an existing user's subscription plan
- Change the company's subscription plan
- Submit usage requests
- Display acceptance and rejection reasons
- Refresh quota information
- View paginated usage history

Custom plan creation and editing are supported by the REST API rather than dashboard forms.

The dashboard is intended for local demonstration and development, not production authentication.

### Run the Frontend in Development Mode

```bash
cd client
npm ci
npm run dev
```

Development URL:

http://localhost:5173

The frontend development proxy expects the backend API on port 8080.

## Project Demonstration Guide

The following scenarios demonstrate the main requirements of the project.

For reproducibility, use a dedicated demo company rather than an account with important existing data.

### Scenario 1: Two Users with Different Plans

Create a company with the Starter plan.

Register:

| User | Plan | Monthly Allowance | Maximum Per Request |
| --- | --- | ---: | ---: |
| Alice | Basic | 1,000 | 100 |
| Bob | Premium | 10,000 | 1,000 |

Both users belong to the same company.

They have separate individual quotas but share the company's monthly allowance.

### Scenario 2: Accepted Usage

Select Alice and submit 10 units.

Expected:

```text
Accepted
```

Assuming no earlier requests:

- Alice used units: 10
- Company used units: 10
- Alice remaining units: 990
- Company remaining units: 9,990

This demonstrates successful consumption against both quota levels.

### Scenario 3: User Per-Request Limit Rejection

While Alice has the Basic plan, submit 101 units.

Expected:

```text
Rejected: user_max_units_per_request_exceeded
```

The request exceeds Basic's 100-unit per-request maximum.

Neither the company nor Alice should consume additional units.

### Scenario 4: User Monthly Quota Rejection

Switch Bob to Premium if necessary.

Submit several individually allowed requests until Bob has consumed more than 1,000 units.

Then switch Bob to Basic.

Expected:

- Current user plan: Basic
- Monthly allowance: 1,000
- Previously consumed units: preserved
- Remaining units: 0

Now submit another 10 units.

Expected:

```text
Rejected: user_monthly_quota_exceeded
```

This demonstrates that switching plans does not reset already consumed units.

### Scenario 5: Shared Company Quota Rejection

Suppose the company has already consumed 2,000 units.

Create a custom company plan with:

```json
{
  "name": "QuotaDemoPlan",
  "monthlyAllowance": 2001,
  "maxUnitsPerRequest": 1000
}
```

Assign the custom plan to the company.

Expected company state:

| Property | Value |
| --- | ---: |
| Monthly allowance | 2,001 |
| Used units | 2,000 |
| Remaining units | 1 |

Select a user who still has enough individual allowance to consume 10 units.

Submit 10 units.

Expected:

```text
Rejected: account_monthly_quota_exceeded
```

The request is rejected because the company's shared remaining allowance is insufficient.

The user and company usage counters must remain unchanged.

### Scenario 6: Company Plan Upgrade

Switch the company from QuotaDemoPlan to Pro.

Assuming the company has consumed 2,000 units:

| Property | Before | After |
| --- | ---: | ---: |
| Monthly allowance | 2,001 | 100,000 |
| Used units | 2,000 | 2,000 |
| Remaining units | 1 | 98,000 |

The previously consumed units remain unchanged.

The new plan applies immediately without changing the example client code or restarting the service.

### Scenario 7: View Request History

Open the Recent Usage History section.

Confirm that both accepted and rejected decisions appear.

Check the stored:

- Request date
- User ID
- Units requested
- Acceptance or rejection status
- Rejection reason

Use the Previous and Next buttons to test pagination.

Historical months can also be queried through the REST API.

## Product Assumptions and Design Decisions

The project brief leaves some behavior unspecified. The following choices are used consistently throughout the implementation.

### Single Resource Type

The system measures one generic resource called units.

Units may represent document-processing credits, API consumption, or another application-defined resource.

Billing and payment processing are outside the scope.

### UTC Monthly Periods

Monthly quotas use UTC calendar months.

Usage belongs to the month in which the request is processed.

Each new month begins with zero consumption.

Previous months remain available for history and reporting.

### All-or-Nothing Usage

Requests are either fully accepted or fully rejected.

Partial consumption is not supported.

### Combined Account and User Rules

Every usage request must satisfy both the account plan and the user's plan.

A larger user allowance never overrides the company's shared quota.

### Plan Changes

Plan changes apply to new requests after the update succeeds.

Changing an assigned plan does not reset existing usage.

If consumption already exceeds the new monthly allowance, the remaining allowance becomes zero and new consumption is rejected.

Updating a shared custom plan affects the users or accounts assigned to that plan.

### Custom Plan Ownership

Built-in plans are shared across accounts and cannot be modified by individual tenants.

Custom plans belong to the company that created them.

Other companies cannot modify or assign plans they do not own.

### Decision Precedence

The service checks rules in this order:

1. Company maximum units per request
2. User maximum units per request
3. Company monthly allowance
4. User monthly allowance

The first failing rule determines the rejection reason.

### Idempotency Scope

Idempotency keys are unique within an account.

Identical retries return the previously recorded decision.

A conflicting reuse of a key returns HTTP 409.

### Authentication and Isolation

The account identity comes from the authenticated API key, not from a company ID supplied by the client.

The backend validates ownership before operating on user data.

### History Preservation

Accepted and rejected decisions remain stored.

Plan changes do not remove historical usage information.

## Concurrency Control

Quota decisions must remain correct when several requests arrive simultaneously.

The service uses PostgreSQL transactions and row-level locking.

For each usage request, the backend:

1. Opens a database transaction.
2. Locks the relevant company record.
3. Checks for an existing idempotency key.
4. Validates user ownership.
5. Loads the currently assigned plans.
6. Creates monthly counters if necessary.
7. Locks the relevant counter rows.
8. Evaluates applicable limits.
9. Records the decision.
10. Updates both counters if the request is accepted.
11. Commits the transaction.

This prevents concurrent requests from independently approving usage against the same remaining quota.

### Performance Tradeoff

Locking the company record favors correctness over maximum throughput.

Many requests against the same company may be serialized, increasing latency.

Future optimizations must preserve accurate quota enforcement and idempotency.

## Automated Testing

The project includes 28 automated tests across five test files.

Tests cover:

- API-key authentication
- Missing and invalid credentials
- Account isolation
- User ownership
- User listing
- Custom plan creation and updates
- Plan assignments
- Monthly quota enforcement
- Maximum per-request limits
- Accepted and rejected requests
- Idempotency
- Concurrent usage requests
- Usage history
- Pagination

The test suite most recently passed with:

```text
Test Files  5 passed (5)
Tests       28 passed (28)
```

### Run Backend Tests

Configure a PostgreSQL database for testing.

Integration tests operate on the configured database and may create or remove records.

**Use an isolated test database rather than production data.**

Install dependencies:

```bash
npm ci
```

Run the tests:

```bash
npm test
```

Check TypeScript:

```bash
npx tsc --noEmit
```

### Build the Frontend

```bash
cd client
npm ci
npm run build
```

### Validate Docker Compose

From the project root:

```bash
docker compose --env-file .env.docker config --quiet
```

## Performance Benchmarking

Performance tests were conducted locally against the Docker-hosted API.

Results reflect the tested environment and are not guaranteed production throughput.

### Read-Only HTTP Benchmarks

Autocannon was used with 10 concurrent connections for 15 seconds.

| Endpoint | Average Requests/Second | Median Latency | p99 Latency |
| --- | ---: | ---: | ---: |
| GET `/api/healthz` | 2,939.54 | 2 ms | 14 ms |
| GET `/api/account/usage` | 298.54 | 31 ms | 69 ms |

An additional five-second authenticated account-usage benchmark completed 1,091 requests, all returning HTTP 200.

### Reproduce the Health Benchmark

With the API running:

```bash
npx --yes autocannon -c 10 -d 15 \
  http://localhost:8080/api/healthz
```

### Reproduce the Authenticated Quota Benchmark

```bash
read -rsp "Enter API key: " API_KEY
echo

npx --yes autocannon -c 10 -d 15 \
  -H "Authorization: ApiKey $API_KEY" \
  http://localhost:8080/api/account/usage

unset API_KEY
```

Autocannon is installed or executed through `npx`; an Internet connection may be required the first time.

### Usage Write Benchmark

The repository includes:

```text
benchmarks/usage-benchmark.mjs
```

The script creates a disposable Starter account and Basic user, then submits 250 usage requests using 10 concurrent workers.

Each logical request uses a unique idempotency key.

Observed results:

| Metric | Result |
| --- | ---: |
| Total requests | 250 |
| Accepted | 250 |
| Rejected | 0 |
| Errors | 0 |
| Duplicates | 0 |
| Duration | 10.66 seconds |
| Throughput | 23.45 requests/sec |
| Average latency | 422.20 ms |
| p50 latency | 458.70 ms |
| p95 latency | 513.96 ms |
| p99 latency | 566.00 ms |

### Run the Write Benchmark

The API must be running on `http://localhost:8080`.

**Warning:** This benchmark creates database records and does not automatically delete them. Run it only against an isolated development or test database.

```bash
ALLOW_USAGE_BENCHMARK=yes node benchmarks/usage-benchmark.mjs
```

The environment variable acts as a safety gate to prevent accidental execution.

After running, clean up the generated test data using an appropriate database procedure.

### Performance Observations

- Simple health requests have relatively low latency.
- Authenticated quota reads involve database operations and have higher latency.
- Concurrent writes to a single account contend for the same account lock.
- Correctness and quota consistency are prioritized over maximum single-account write throughput.
- Results may vary with hardware, database configuration, and request patterns.

The write benchmark measures contention against one account rather than maximum throughput across independent accounts.

## Security Considerations

The implementation includes:

- Hashed API-key storage
- API-key authentication
- Account-scoped data access
- Ownership checks for users and custom plans
- Input validation using Zod
- Idempotency protection
- Transactional quota updates
- Secret environment files excluded from Git

For production use, additional measures would be required, including:

- HTTPS/TLS
- Managed secret storage
- Secure API-key rotation
- Rate limiting
- Additional operational monitoring
- Audit logging
- Least-privilege database access
- Isolated testing infrastructure

The current React dashboard requires manual entry of a company API key and is intended for local demonstration.

A production application should generally keep company API keys on a trusted server rather than exposing them directly to browser clients.

## Known Limitations

- The example frontend demonstrates quota consumption rather than processing a real document or performing billing.
- Custom-plan creation and editing are available through REST endpoints rather than React forms.
- The dashboard does not provide a user deletion or deactivation interface.
- Permanent deletion of users may conflict with preserving request history; deactivation would be a preferable future feature.
- High write contention for a single company can reduce throughput because of row-level locking.
- Integration tests and write benchmarks require isolated database environments.
- The system does not implement billing, refunds, multiple resource types, or end-user login.
- Production deployment would require stronger security, monitoring, and operational safeguards.



## License

ISC, as specified in `package.json`.
