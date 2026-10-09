# EasyPay API

EasyPay is a unified payment orchestration API that provides a seamless interface for businesses to accept payments, process payouts, and manage transactions across multiple payment providers (like Paystack and Flutterwave) without vendor lock-in.

## Features

- **Multi-Provider Support**: Integrate with multiple payment gateways (Paystack, Flutterwave, etc.) using a single unified API.
- **Dynamic Routing & Failover**: Automatically route transactions to the most optimal or available provider. If one provider fails, the system automatically falls back to the next available one.
- **Idempotency**: Built-in support for idempotency keys to ensure that requests are processed only once, preventing duplicate charges.
- **Secure Authentication & Authorization**: API keys are securely hashed using bcrypt and symmetric encryption (AES-256) is used for storing sensitive provider credentials.
- **Webhooks Deduplication & Processing**: Secure webhook processing with signature verification and deduplication to ensure events are recorded accurately.
- **Atomic Operations**: Safe concurrent processing of operations like refunds to avoid race conditions.
- **Rate Limiting & Usage Tracking**: Implements tier-based rate limits and tracks API usage for different billing plans (Free, Pro, Enterprise).
- **Graceful Shutdown**: Handles process termination signals gracefully, ensuring all active requests and database connections are closed cleanly.
- **Comprehensive Testing**: Fully tested using Vitest.

## Tech Stack

- **Node.js & Express**: Core application framework.
- **TypeScript**: Static typing for robustness and better developer experience.
- **Prisma ORM**: Database access and schema management.
- **Neon (PostgreSQL)**: Scalable Serverless Postgres database.
- **Zod**: Runtime type validation for API payloads.
- **Pino**: High-performance structured logging.
- **Vitest**: Blazing fast unit testing framework.

## Setup Instructions

### 1. Clone the repository

```bash
git clone https://github.com/Akamumpa0/EasyPay.git
cd EasyPay
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy the example environment file and configure the values:

```bash
cp .env.example .env
```

Ensure you set the correct database URLs and generate secure random strings for `ENCRYPTION_KEY` (64 hex characters) and `JWT_SECRET`.

### 4. Setup the Database

Push the Prisma schema to your Neon database and generate the client:

```bash
npx prisma db push
npx prisma generate
```

### 5. Run the Server

**Development Mode:**
```bash
npm run dev
```

**Production Mode:**
```bash
npm run build
npm start
```

## Running Tests

Run the complete test suite using Vitest:

```bash
npm test
```
