import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticateApiKey, AuthenticatedRequest } from '../middlewares/auth';
import { checkTransactionLimit } from '../middlewares/billing';
import { ProviderRouter } from '../services/ProviderRouter';
import prisma from '../lib/prisma';

const router = Router();
const providerRouter = new ProviderRouter();

const chargeSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3),
  customer_email: z.string().email(),
  payment_method: z.string().optional(),
  idempotency_key: z.string().min(1),
  preferred_provider: z.enum(['flutterwave', 'paystack']).optional(),
});

router.post('/', authenticateApiKey, checkTransactionLimit, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const merchantId = req.merchant.id;
    const { amount, currency, customer_email, payment_method, idempotency_key, preferred_provider } =
      chargeSchema.parse(req.body);

    // 1. Idempotency Check
    const existingTx = await prisma.transaction.findUnique({
      where: {
        merchant_id_idempotency_key: { merchant_id: merchantId, idempotency_key },
      },
    });

    if (existingTx) {
      return res.status(200).json({ status: 'success', data: existingTx });
    }

    // 2. Charge via Provider Router (handles selection, credential decryption, and failover)
    const { result: chargeResult, providerFeeAmount } = await providerRouter.routeCharge(
      { amount, currency, customer_email, payment_method, idempotency_key },
      merchantId,
      preferred_provider,
    );

    // 3. Calculate Platform Fee
    const platformFeePercent = req.merchant.platform_fee_percent || 0.5;
    const platformFeeAmount = amount * (platformFeePercent / 100);

    // 4. Save Transaction — store provider_transaction_id for webhook matching and refunds
    const transaction = await prisma.transaction.create({
      data: {
        merchant_id: merchantId,
        provider_used: chargeResult.provider,
        provider_transaction_id: chargeResult.transaction_id,
        amount,
        currency,
        customer_email,
        idempotency_key,
        status: chargeResult.status,
        platform_fee_amount: platformFeeAmount,
        provider_fee_amount: providerFeeAmount,
        raw_provider_response: chargeResult.raw,
      },
    });

    // 5. Update Usage Record
    if (transaction.status === 'success' || transaction.status === 'pending') {
      const currentDate = new Date();
      const period = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

      await prisma.usageRecord.upsert({
        where: { merchant_id_period: { merchant_id: merchantId, period } },
        update: {
          transaction_count: { increment: 1 },
          total_platform_fees_earned: { increment: platformFeeAmount },
        },
        create: {
          merchant_id: merchantId,
          period,
          transaction_count: 1,
          total_platform_fees_earned: platformFeeAmount,
        },
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        transaction_id: transaction.id,
        provider: transaction.provider_used,
        status: transaction.status,
        checkout_url: chargeResult.checkout_url,
        platform_fee: transaction.platform_fee_amount,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
