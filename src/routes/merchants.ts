import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticateApiKey, AuthenticatedRequest } from '../middlewares/auth';

import { encrypt } from '../utils/encryption';
import prisma from '../lib/prisma';

const router = Router();

const credentialSchema = z.object({
  provider_name: z.enum(['flutterwave', 'paystack']),
  api_key: z.string(),
  secret_key: z.string(),
  is_live_mode: z.boolean().default(false),
});

router.post('/provider-credentials', authenticateApiKey, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const merchantId = req.merchant.id;
    const { provider_name, api_key, secret_key, is_live_mode } = credentialSchema.parse(req.body);

    // 1. Check if provider exists
    const provider = await prisma.provider.findUnique({ where: { name: provider_name } });

    if (!provider) {
      return res.status(400).json({ status: 'error', message: 'Unsupported provider' });
    }

    // 2. Encrypt credentials
    const encryptedApiKey = encrypt(api_key);
    const encryptedSecretKey = encrypt(secret_key);

    // 3. Upsert credentials
    await prisma.merchantProviderCredential.upsert({
      where: {
        merchant_id_provider_id_is_live_mode: {
          merchant_id: merchantId,
          provider_id: provider.id,
          is_live_mode,
        },
      },
      update: { encrypted_api_key: encryptedApiKey, encrypted_secret_key: encryptedSecretKey },
      create: {
        merchant_id: merchantId,
        provider_id: provider.id,
        encrypted_api_key: encryptedApiKey,
        encrypted_secret_key: encryptedSecretKey,
        is_live_mode,
      },
    });

    res.status(200).json({
      status: 'success',
      message: `${provider_name} credentials securely stored.`,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
