import prisma from '../lib/prisma';
import { PayoutParams, NormalizedPayoutResult, PayoutProvider } from '../providers/PayoutProvider';
import { providerRegistry } from '../providers';
import { decrypt } from '../utils/encryption';
import { EasyPayError, EasyPayErrorCode } from '../utils/errors';
import logger from '../lib/logger';

export class PayoutRouter {
  async routePayout(
    params: PayoutParams,
    merchantId: string,
    preferredProvider?: string,
  ): Promise<NormalizedPayoutResult> {
    // 1. Fetch active providers that support the currency
    const availableProviders = await prisma.provider.findMany({
      where: {
        is_active: true,
        supported_currencies: { has: params.currency },
      },
      orderBy: { priority: 'asc' }, // Lower number = higher priority
    });

    if (availableProviders.length === 0) {
      throw new EasyPayError(EasyPayErrorCode.PROVIDER_ERROR, `No active providers support currency: ${params.currency}`);
    }

    // 2. Fetch merchant credentials for these providers
    const providerIds = availableProviders.map((p) => p.id);
    const credentials = await prisma.merchantProviderCredential.findMany({
      where: {
        merchant_id: merchantId,
        provider_id: { in: providerIds },
      },
    });

    if (credentials.length === 0) {
      throw new EasyPayError(EasyPayErrorCode.PROVIDER_ERROR, 'Merchant has no configured credentials for supported providers');
    }

    // 3. Map credentials back to provider names
    const credentialMap = new Map<string, (typeof credentials)[0]>();
    for (const cred of credentials) {
      const p = availableProviders.find((p) => p.id === cred.provider_id);
      if (p) credentialMap.set(p.name, cred);
    }

    // 4. Order providers to attempt
    let attemptOrder = availableProviders
      .filter((p) => credentialMap.has(p.name))
      .map((p) => p.name);

    if (preferredProvider && attemptOrder.includes(preferredProvider)) {
      attemptOrder = [preferredProvider, ...attemptOrder.filter((name) => name !== preferredProvider)];
    }

    if (attemptOrder.length === 0) {
      throw new EasyPayError(EasyPayErrorCode.PROVIDER_ERROR, 'No valid providers with credentials found');
    }

    // 5. Failover logic
    let lastError: any;
    for (const providerName of attemptOrder) {
      try {
        // Cast via unknown to satisfy strict type overlap check between ChargeProvider and PayoutProvider
        const providerInstance = providerRegistry.getProvider(providerName) as unknown as PayoutProvider;
        if (!providerInstance || typeof providerInstance.payout !== 'function') {
          throw new Error(`Provider ${providerName} does not support payouts`);
        }

        const cred = credentialMap.get(providerName)!;
        const decryptedKeys = {
          publicKey: decrypt(cred.encrypted_api_key),
          secretKey: decrypt(cred.encrypted_secret_key),
          isLive: cred.is_live_mode,
        };

        const result = await providerInstance.payout(params, decryptedKeys);
        return result;
      } catch (error) {
        logger.warn({ provider: providerName, err: error }, '[PayoutRouter] Payout failed, trying next provider');
        lastError = error;
        // Continue to next provider (failover)
      }
    }

    if (lastError instanceof EasyPayError) {
      throw lastError;
    }
    // Log full error server-side; expose only a safe generic message to the client
    logger.error({ err: lastError }, '[PayoutRouter] All providers failed');
    throw new EasyPayError(
      EasyPayErrorCode.UNKNOWN,
      'Payout processing failed. Please try again later.',
    );
  }
}
