import { Router, Response } from 'express';
import { authenticateApiKey, AuthenticatedRequest } from '../middlewares/auth';
import { providerRegistry } from '../providers';
import { decrypt } from '../utils/encryption';
import prisma from '../lib/prisma';

const router = Router();

// GET /v1/transactions?page=1&limit=20
router.get('/', authenticateApiKey, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const merchantId = req.merchant.id;
    const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 20));
    const skip = (page - 1) * limit;

    const [transactions, total] = await prisma.$transaction([
      prisma.transaction.findMany({
        where: { merchant_id: merchantId },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.transaction.count({ where: { merchant_id: merchantId } }),
    ]);

    res.status(200).json({
      status: 'success',
      data: transactions,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

// GET /v1/transactions/:id
router.get('/:id', authenticateApiKey, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const merchantId = req.merchant.id;
    const id = req.params['id'] as string;

    const transaction = await prisma.transaction.findUnique({ where: { id } });

    if (!transaction || transaction.merchant_id !== merchantId) {
      return res.status(404).json({ status: 'error', message: 'Transaction not found' });
    }

    res.status(200).json({ status: 'success', data: transaction });
  } catch (error) {
    next(error);
  }
});

// POST /v1/transactions/:id/refund
router.post('/:id/refund', authenticateApiKey, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const merchantId = req.merchant!.id;
    const id = req.params['id'] as string;

    // First, fetch without locking so we can give specific errors for 404 vs wrong state
    const transaction = await prisma.transaction.findUnique({ where: { id } });

    if (!transaction || transaction.merchant_id !== merchantId) {
      return res.status(404).json({ status: 'error', message: 'Transaction not found' });
    }

    if (transaction.status !== 'success') {
      return res.status(400).json({ status: 'error', message: 'Only successful transactions can be refunded' });
    }

    if (!transaction.provider_transaction_id) {
      return res.status(500).json({ status: 'error', message: 'Provider transaction ID not found — cannot refund' });
    }

    const provider = providerRegistry.getProvider(transaction.provider_used);
    if (!provider) {
      return res.status(500).json({ status: 'error', message: 'Provider not configured' });
    }

    const providerRecord = await prisma.provider.findUnique({ where: { name: provider.name } });
    if (!providerRecord) {
      return res.status(500).json({ status: 'error', message: 'Provider record not found' });
    }

    const credential = await prisma.merchantProviderCredential.findFirst({
      where: { merchant_id: merchantId, provider_id: providerRecord.id },
    });

    if (!credential) {
      return res.status(500).json({ status: 'error', message: 'Provider credentials not found' });
    }

    const decryptedKeys = {
      publicKey: decrypt(credential.encrypted_api_key),
      secretKey: decrypt(credential.encrypted_secret_key),
      isLive: credential.is_live_mode,
    };

    // Atomic status transition: only succeeds if status is still 'success'.
    // Prevents double-refund from concurrent requests — one will get count=0.
    const { count } = await prisma.transaction.updateMany({
      where: { id, merchant_id: merchantId, status: 'success' },
      data: { status: 'reversed' },
    });

    if (count === 0) {
      return res.status(409).json({ status: 'error', message: 'Transaction has already been refunded or is no longer refundable' });
    }

    // Call provider refund after the DB row is locked to 'reversed'
    const refundResult = await provider.refund(
      transaction.provider_transaction_id,
      transaction.amount,
      decryptedKeys,
    );

    const updatedTransaction = await prisma.transaction.findUnique({ where: { id } });

    res.status(200).json({
      status: 'success',
      message: 'Transaction refunded successfully',
      data: { transaction: updatedTransaction, provider_refund_id: refundResult.provider_refund_id },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
