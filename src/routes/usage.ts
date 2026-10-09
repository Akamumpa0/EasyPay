import { Router, Response } from 'express';
import { authenticateApiKey, AuthenticatedRequest } from '../middlewares/auth';
import prisma from '../lib/prisma';

const router = Router();


// Get all usage records for a merchant
router.get('/', authenticateApiKey, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const merchantId = req.merchant.id;

    const usageRecords = await prisma.usageRecord.findMany({
      where: {
        merchant_id: merchantId,
      },
      orderBy: {
        period: 'desc',
      },
    });

    res.status(200).json({
      status: 'success',
      data: usageRecords,
    });
  } catch (error) {
    next(error);
  }
});

// Get current month's usage record
router.get('/current', authenticateApiKey, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const merchantId = req.merchant.id;
    const currentDate = new Date();
    const period = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

    const usageRecord = await prisma.usageRecord.findUnique({
      where: {
        merchant_id_period: {
          merchant_id: merchantId,
          period,
        },
      },
    });

    if (!usageRecord) {
      return res.status(200).json({
        status: 'success',
        data: {
          merchant_id: merchantId,
          period,
          transaction_count: 0,
          total_platform_fees_earned: 0,
        },
      });
    }

    res.status(200).json({
      status: 'success',
      data: usageRecord,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
