import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import prisma from '../lib/prisma';

const BILLING_LIMITS: Record<string, number> = {
  free: 100,
  pro: 1000,
  enterprise: Infinity,
};

export const checkTransactionLimit = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const merchantId = req.merchant.id;
    const billingPlan: string = req.merchant.billing_plan || 'free';

    const limit = BILLING_LIMITS[billingPlan] ?? BILLING_LIMITS['free']!;

    if (limit === Infinity) {
      return next();
    }

    const currentDate = new Date();
    const period = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

    const usage = await prisma.usageRecord.findUnique({
      where: { merchant_id_period: { merchant_id: merchantId, period } },
    });

    if (usage && usage.transaction_count >= limit) {
      return res.status(403).json({
        status: 'error',
        message: `Monthly transaction limit exceeded for plan: ${billingPlan}. Limit: ${limit}`,
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};
