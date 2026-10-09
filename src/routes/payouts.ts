import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticateApiKey, AuthenticatedRequest } from '../middlewares/auth';
import { PayoutRouter } from '../services/PayoutRouter';
import prisma from '../lib/prisma';

const router = Router();
const payoutRouter = new PayoutRouter();

const PayoutSchema = z.object({
  amount: z.number().positive('Amount must be a positive number'),
  currency: z.string().min(3).max(3).toUpperCase(),
  destination_account_number: z.string().min(1, 'Destination account number is required'),
  destination_bank_code: z.string().min(1, 'Destination bank code is required'),
  idempotency_key: z.string().min(1, 'Idempotency key is required'),
  preferred_provider: z.enum(['flutterwave', 'paystack']).optional(),
});

// POST /v1/payouts — Initiate a payout
router.post('/', authenticateApiKey, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const merchantId = req.merchant.id;

    const parsed = PayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const { amount, currency, destination_account_number, destination_bank_code, idempotency_key, preferred_provider } =
      parsed.data;

    // Idempotency protection
    const existingPayout = await prisma.payout.findUnique({
      where: { merchant_id_idempotency_key: { merchant_id: merchantId, idempotency_key } },
    });

    if (existingPayout) {
      return res.status(200).json({
        status: 'success',
        message: 'Payout already processed (idempotent response)',
        data: existingPayout,
      });
    }

    // Route the payout through the PayoutRouter (with failover)
    const result = await payoutRouter.routePayout(
      { amount, currency, destination_account_number, destination_bank_code, idempotency_key },
      merchantId,
      preferred_provider,
    );

    // Persist the payout record
    const payout = await prisma.payout.create({
      data: {
        merchant_id: merchantId,
        provider_used: result.provider,
        amount,
        currency,
        status: result.status,
        idempotency_key,
        destination_account_number,
        destination_bank_code,
        raw_provider_response: result.raw,
      },
    });

    res.status(201).json({
      status: 'success',
      message: 'Payout initiated successfully',
      data: payout,
    });
  } catch (error) {
    next(error);
  }
});

// GET /v1/payouts?page=1&limit=20
router.get('/', authenticateApiKey, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const merchantId = req.merchant.id;
    const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 20));
    const skip = (page - 1) * limit;

    const [payouts, total] = await prisma.$transaction([
      prisma.payout.findMany({
        where: { merchant_id: merchantId },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.payout.count({ where: { merchant_id: merchantId } }),
    ]);

    res.status(200).json({
      status: 'success',
      data: payouts,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

// GET /v1/payouts/:id
router.get('/:id', authenticateApiKey, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const merchantId = req.merchant.id;
    const id = req.params['id'] as string;

    const payout = await prisma.payout.findUnique({ where: { id } });

    if (!payout || payout.merchant_id !== merchantId) {
      return res.status(404).json({ status: 'error', message: 'Payout not found' });
    }

    res.status(200).json({ status: 'success', data: payout });
  } catch (error) {
    next(error);
  }
});

export default router;
