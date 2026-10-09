import prisma from '../lib/prisma';
import { ChargeParams, NormalizedChargeResult } from '../providers/ChargeProvider';
import { providerRegistry } from '../providers';
import { decrypt } from '../utils/encryption';
import { EasyPayError, EasyPayErrorCode } from '../utils/errors';
import logger from '../lib/logger';

export class ProviderRouter {
  // Providers are now dynamically resolved from ProviderRegistry

  async routeCharge(
    params: ChargeParams,
    merchantId: string,
    preferredProvider?: string
  ): Promise<{ result: NormalizedChargeResult; providerFeeAmount?: number }> {
    // 1. Fetch active providers that support the currency
    const availableProviders = await prisma.provider.findMany({
      where: {
        is_active: true,
        supported_currencies: {
          has: params.currency,
        },
      },
      orderBy: {
        priority: 'asc', // Lower number = higher priority
      },
    });

    if (availableProviders.length === 0) {
      throw new Error(`No active providers support currency: ${params.currency}`);
    }

    // 2. Fetch merchant credentials for these providers
    const providerIds = availableProviders.map(p => p.id);
    const credentials = await prisma.merchantProviderCredential.findMany({
      where: {
        merchant_id: merchantId,
        provider_id: { in: providerIds },
      },
    });

    if (credentials.length === 0) {
      throw new Error('Merchant has no configured credentials for supported providers');
    }

    // 3. Map credentials back to provider names
    const credentialMap = new Map();
    for (const cred of credentials) {
      const p = availableProviders.find(p => p.id === cred.provider_id);
      if (p) credentialMap.set(p.name, cred);
    }

    // 4. Order providers to attempt
    let attemptOrder = availableProviders
      .filter(p => credentialMap.has(p.name))
      .map(p => p.name);

    if (preferredProvider && attemptOrder.includes(preferredProvider)) {
      // Move preferred to front
      attemptOrder = [
        preferredProvider,
        ...attemptOrder.filter(name => name !== preferredProvider),
      ];
    }

    if (attemptOrder.length === 0) {
       throw new Error('No valid providers with credentials found');
    }

    // 5. Failover logic
    let lastError: any;
    for (const providerName of attemptOrder) {
      try {
        const providerInstance = providerRegistry.getProvider(providerName);
        if (!providerInstance) {
          throw new Error(`Provider instance for ${providerName} not implemented or registered`);
        }

        const cred = credentialMap.get(providerName);
        const decryptedKeys = {
          publicKey: decrypt(cred.encrypted_api_key),
          secretKey: decrypt(cred.encrypted_secret_key),
          isLive: cred.is_live_mode,
        };

        const result = await providerInstance.charge(params, decryptedKeys);
        return { result, providerFeeAmount: result.provider_fee };
      } catch (error) {
        logger.warn({ provider: providerName, err: error }, '[ProviderRouter] Charge failed, trying next provider');
        lastError = error;
        // Continue to next provider in attemptOrder
      }
    }

    if (lastError instanceof EasyPayError) {
      throw lastError;
    }
    // Log full error server-side; expose only a safe generic message to the client
    logger.error({ err: lastError }, '[ProviderRouter] All providers failed');
    throw new EasyPayError(EasyPayErrorCode.UNKNOWN, 'Payment processing failed. Please try again later.');
  }
}
