# Usage Metering Dashboard

A React + TypeScript frontend for the Usage Metering and Quota Service.

This dashboard provides a user-friendly interface for interacting with the backend API and monitoring company and user consumption.

## Features

- Connect to a company using its API key.
- View company and user subscription plans.
- Monitor monthly usage and remaining quotas.
- Create Basic and Premium users.
- Submit usage requests and view acceptance or rejection reasons.
- Switch company and user subscription plans.
- View paginated usage history.

##  Run with Docker (Recommended)


From the project root:

```bash
cp .env.docker.example .env.docker
```

Configure the database password, then run:

```bash
docker compose --env-file .env.docker up --build -d
```

Open **http://localhost:3000**.

Create a company using the backend API and enter its generated API key to connect.

## Frontend Development

Requirements: Node.js and npm, with the backend API running on port 8080.

From the `client` directory:

```bash
npm ci
npm run dev
```

Open **http://localhost:5173**.

For a production frontend build:

```bash
npm run build
```

## Technology

- React
- TypeScript
- Vite
- Nginx (Docker deployment)

## Notes

The dashboard is intended for local demonstration and development. Company API keys are entered manually; production use would require a more secure administrator authentication system.

Custom-plan creation and editing are supported through the backend REST API rather than dashboard forms.

For API documentation, project architecture, tests, and demonstration instructions, see the [main README](../README.md).
