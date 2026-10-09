import crypto from 'crypto';
import { ChargeProvider, ChargeParams, NormalizedChargeResult, NormalizedWebhookEvent } from './ChargeProvider';
import { PayoutProvider, PayoutParams, NormalizedPayoutResult } from './PayoutProvider';
import { EasyPayError, EasyPayErrorCode } from '../utils/errors';

export class PaystackProvider implements ChargeProvider, PayoutProvider {
  name = 'paystack';

  private mapError(error: any): EasyPayError {
    if (error instanceof EasyPayError) return error;
    return new EasyPayError(EasyPayErrorCode.PROVIDER_ERROR, error?.message || 'Unknown provider error', error);
  }

  async charge(params: ChargeParams, credentials: { publicKey: string; secretKey: string; isLive: boolean }): Promise<NormalizedChargeResult> {
    try {
      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: Math.round(params.amount * 100), // Convert to kobo
          email: params.customer_email,
          currency: params.currency,
          reference: params.idempotency_key,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.status) {
        throw new Error(data.message || 'Failed to initialize transaction');
      }

      return {
        status: 'pending',
        provider: this.name,
        transaction_id: data.data.reference,
        checkout_url: data.data.authorization_url,
        raw: data,
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async refund(
    providerTransactionId: string,
    amount: number,
    credentials: { publicKey: string; secretKey: string; isLive: boolean },
  ): Promise<{ status: string; provider_refund_id: string }> {
    try {
      const response = await fetch('https://api.paystack.co/refund', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transaction: providerTransactionId,
          amount: Math.round(amount * 100), // Convert to kobo
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.status) {
        throw new Error(data.message || 'Failed to initialize refund');
      }

      return {
        status: 'success',
        provider_refund_id: data.data.id.toString(),
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async payout(
    params: PayoutParams,
    credentials: { publicKey: string; secretKey: string; isLive: boolean },
  ): Promise<NormalizedPayoutResult> {
    try {
      // Step 1: Create a transfer recipient
      const recipientResponse = await fetch('https://api.paystack.co/transferrecipient', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'nuban',
          name: 'Recipient',
          account_number: params.destination_account_number,
          bank_code: params.destination_bank_code,
          currency: params.currency,
        }),
      });

      const recipientData = await recipientResponse.json();

      if (!recipientResponse.ok || !recipientData.status) {
        throw new Error(recipientData.message || 'Failed to create transfer recipient');
      }

      const recipientCode: string = recipientData.data.recipient_code;

      // Step 2: Initiate the transfer
      const transferResponse = await fetch('https://api.paystack.co/transfer', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: 'balance',
          amount: Math.round(params.amount * 100), // Convert to kobo
          reference: params.idempotency_key,
          recipient: recipientCode,
          reason: 'EasyPay payout',
        }),
      });

      const transferData = await transferResponse.json();

      if (!transferResponse.ok || !transferData.status) {
        throw new Error(transferData.message || 'Failed to initiate transfer');
      }

      return {
        status: transferData.data.status === 'success' ? 'success' : 'pending',
        provider: this.name,
        provider_payout_id: transferData.data.transfer_code,
        raw: transferData,
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  verifyWebhookSignature(payload: Buffer | string, signature: string, secretKey: string): boolean {
    const rawBody = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const hash = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
    return hash === signature;
  }

  parseWebhookEvent(payload: any): NormalizedWebhookEvent {
    const statusMap: Record<string, any> = {
      success: 'success',
      failed: 'failed',
      reversed: 'reversed',
    };
    const internalStatus = payload?.data?.status || 'pending';

    return {
      transaction_id: payload.data.reference,
      status: statusMap[internalStatus] || 'pending',
      provider_fee: payload.data.fees ? payload.data.fees / 100 : 0, // Convert from kobo
      raw: payload,
    };
  }

  extractTransactionReference(payload: any): string | null {
    return payload?.data?.reference ?? null;
  }
}
