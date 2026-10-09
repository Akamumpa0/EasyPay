import { Router, Request, Response } from 'express';
import { providerRegistry } from '../providers';
import { decrypt } from '../utils/encryption';
import prisma from '../lib/prisma';

const router = Router();

/**
 * POST /v1/webhooks/:providerName
 *
 * NOTE: express.raw() is applied to this route in index.ts BEFORE the global
 * express.json() middleware, so req.body here is a Buffer containing the raw
 * request bytes — which is what Paystack/Flutterwave sign with HMAC.
 */
router.post('/:providerName', async (req: Request, res: Response, next) => {
  try {
    const providerName = req.params['providerName'] as string;
    const provider = providerRegistry.getProvider(providerName);

    if (!provider) {
      return res.status(404).json({ status: 'error', message: 'Provider not found' });
    }

    // req.body is a raw Buffer (set up by express.raw() in index.ts)
    const rawBody: Buffer = req.body;

    // Parse JSON for business logic (separate from the raw bytes used for HMAC)
    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ status: 'error', message: 'Invalid JSON payload' });
    }

    // Extract the provider's own transaction reference from the payload
    const reference = provider.extractTransactionReference(payload);
    if (!reference) {
      // Irrelevant event type (e.g. chargeback, subscription) — acknowledge and ignore
      return res.status(200).send('Ignored');
    }

    // Look up the transaction using provider_transaction_id (not idempotency_key)
    const transaction = await prisma.transaction.findFirst({
      where: {
        provider_used: providerName,
        provider_transaction_id: reference,
      },
    });

    if (!transaction) {
      // Could be a webhook for a transaction we haven't processed yet or an unknown reference
      return res.status(404).json({ status: 'error', message: 'Transaction not found' });
    }

    // Fetch merchant credentials for signature verification
    const providerRecord = await prisma.provider.findUnique({ where: { name: providerName } });
    if (!providerRecord) {
      return res.status(400).json({ status: 'error', message: 'Provider record not found' });
    }

    const credential = await prisma.merchantProviderCredential.findFirst({
      where: {
        merchant_id: transaction.merchant_id,
        provider_id: providerRecord.id,
      },
    });

    if (!credential) {
      return res.status(400).json({ status: 'error', message: 'Credentials not found' });
    }

    const secretKey = decrypt(credential.encrypted_secret_key);

    // Verify signature using the raw bytes (not the re-serialised JSON object)
    const signature = (req.headers['x-paystack-signature'] || req.headers['verif-hash'] || '') as string;
    const isValid = provider.verifyWebhookSignature(rawBody, signature, secretKey);

    if (!isValid) {
      return res.status(401).json({ status: 'error', message: 'Invalid signature' });
    }

    const normalizedEvent = provider.parseWebhookEvent(payload);

    // Deduplication — skip if this exact provider event was already processed
    const alreadyProcessed = await prisma.webhookEvent.findFirst({
      where: { transaction_id: transaction.id, provider: providerName, verified: true },
    });

    if (alreadyProcessed) {
      return res.status(200).send('OK'); // Acknowledge without reprocessing
    }

    // Save webhook event for auditing
    await prisma.webhookEvent.create({
      data: {
        transaction_id: transaction.id,
        provider: providerName,
        payload: payload as any,
        verified: true,
        processed_at: new Date(),
      },
    });

    // Update transaction status and provider fee
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: normalizedEvent.status,
        provider_fee_amount: normalizedEvent.provider_fee,
      },
    });

    return res.status(200).send('OK');
  } catch (error) {
    next(error);
  }
});

export default router;
