// env must be imported first — it validates all env vars and will exit on failure
import './lib/env';
import { env } from './lib/env';
import logger from './lib/logger';

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';

import { EasyPayError, EasyPayErrorCode } from './utils/errors';
import prisma from './lib/prisma';

import authRoutes from './routes/auth';
import merchantRoutes from './routes/merchants';
import chargeRoutes from './routes/charge';
import transactionsRoutes from './routes/transactions';
import usageRoutes from './routes/usage';
import webhookRoutes from './routes/webhooks';
import payoutsRoutes from './routes/payouts';

const app = express();

// ─── Security & Logging ───────────────────────────────────────────────────────

app.use(helmet());

// CORS — restrict to allowlisted origins in production
const allowedOrigins = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

app.use(
  cors({
    origin: allowedOrigins.length > 0
      ? (origin, cb) => {
          if (!origin || allowedOrigins.includes(origin)) cb(null, true);
          else cb(new Error(`CORS: origin ${origin} not allowed`));
        }
      : true, // Allow all in dev (ALLOWED_ORIGINS is empty)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Structured HTTP request logging via pino-http
app.use(pinoHttp({
  logger,
  // Skip health check spam in logs
  autoLogging: { ignore: (req) => req.url === '/health' },
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many auth attempts, please try again later.' },
});

const chargeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many charge requests, please slow down.' },
});

app.use(globalLimiter);

// ─── Body Parsers ─────────────────────────────────────────────────────────────

/**
 * Webhook routes MUST receive the raw Buffer body so providers can verify
 * HMAC signatures over the original bytes.  This must be registered BEFORE
 * the global express.json() middleware.
 */
app.use('/v1/webhooks', express.raw({ type: 'application/json' }));

// All other routes get a parsed JSON body
app.use(express.json());

// ─── Health Check ─────────────────────────────────────────────────────────────

const START_TIME = Date.now();

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      version: process.env.npm_package_version || '1.0.0',
      uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
      environment: env.NODE_ENV,
      db: 'connected',
    });
  } catch {
    res.status(503).json({
      status: 'degraded',
      db: 'disconnected',
      uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
    });
  }
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/v1/auth', authLimiter, authRoutes);
app.use('/v1/merchants', merchantRoutes);
app.use('/v1/charge', chargeLimiter, chargeRoutes);
app.use('/v1/transactions', transactionsRoutes);
app.use('/v1/usage', usageRoutes);
app.use('/v1/webhooks', webhookRoutes);
app.use('/v1/payouts', payoutsRoutes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────

const ERROR_STATUS_MAP: Partial<Record<EasyPayErrorCode, number>> = {
  [EasyPayErrorCode.INVALID_CREDENTIALS]: 401,
  [EasyPayErrorCode.PROVIDER_ERROR]: 502,
  [EasyPayErrorCode.GATEWAY_TIMEOUT]: 504,
  [EasyPayErrorCode.INSUFFICIENT_FUNDS]: 402,
  [EasyPayErrorCode.CARD_DECLINED]: 402,
  [EasyPayErrorCode.UNKNOWN]: 500,
};

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, '[EasyPay] Unhandled error');

  if (err instanceof EasyPayError) {
    const httpStatus = ERROR_STATUS_MAP[err.code as EasyPayErrorCode] ?? 400;
    return res.status(httpStatus).json({
      status: 'error',
      code: err.code,
      message: err.message,
    });
  }

  // Zod validation errors bubble up as plain errors from .parse()
  if (err?.name === 'ZodError') {
    return res.status(422).json({
      status: 'error',
      message: 'Validation error',
      errors: err.flatten?.().fieldErrors ?? err.issues,
    });
  }

  res.status(500).json({
    status: 'error',
    message: 'Internal server error',
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(env.PORT, 10);

const server = app.listen(PORT, () => {
  logger.info(`EasyPay API running on port ${PORT} [${env.NODE_ENV}]`);
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    logger.info('HTTP server closed. Disconnecting Prisma...');
    await prisma.$disconnect();
    logger.info('Shutdown complete.');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

export default app;
