import { ChargeProvider, ChargeParams, NormalizedChargeResult, NormalizedWebhookEvent } from './ChargeProvider';
import { PayoutProvider, PayoutParams, NormalizedPayoutResult } from './PayoutProvider';
import { EasyPayError, EasyPayErrorCode } from '../utils/errors';

export class FlutterwaveProvider implements ChargeProvider, PayoutProvider {
  name = 'flutterwave';

  private mapError(error: any): EasyPayError {
    if (error instanceof EasyPayError) return error;
    return new EasyPayError(EasyPayErrorCode.PROVIDER_ERROR, error?.message || 'Unknown provider error', error);
  }

  async charge(
    params: ChargeParams,
    credentials: { publicKey: string; secretKey: string; isLive: boolean },
  ): Promise<NormalizedChargeResult> {
    try {
      const response = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tx_ref: params.idempotency_key,
          amount: params.amount,
          currency: params.currency,
          customer: {
            email: params.customer_email,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to initialize transaction');
      }

      return {
        status: 'pending',
        provider: this.name,
        transaction_id: params.idempotency_key,
        checkout_url: data.data.link,
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
      const response = await fetch(`https://api.flutterwave.com/v3/transactions/${providerTransactionId}/refund`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount }),
      });

      const data = await response.json();

      if (!response.ok || data.status !== 'success') {
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
      const response = await fetch('https://api.flutterwave.com/v3/transfers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account_bank: params.destination_bank_code,
          account_number: params.destination_account_number,
          amount: params.amount,
          currency: params.currency,
          reference: params.idempotency_key,
          narration: 'EasyPay payout',
        }),
      });

      const data = await response.json();

      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to initiate transfer');
      }

      return {
        status: data.data.status === 'SUCCESSFUL' ? 'success' : 'pending',
        provider: this.name,
        provider_payout_id: data.data.id.toString(),
        raw: data,
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Flutterwave uses a static "verif-hash" header set in the dashboard.
   * The merchant stores this hash as their encrypted_secret_key so we
   * compare the header value directly to secretKey.
   */
  verifyWebhookSignature(payload: Buffer | string, signature: string, secretKey: string): boolean {
    return signature === secretKey;
  }

  parseWebhookEvent(payload: any): NormalizedWebhookEvent {
    const statusMap: Record<string, any> = {
      successful: 'success',
      failed: 'failed',
    };
    return {
      transaction_id: payload?.data?.tx_ref,
      status: statusMap[payload?.data?.status] || 'pending',
      provider_fee: payload?.data?.app_fee,
      raw: payload,
    };
  }

  extractTransactionReference(payload: any): string | null {
    return payload?.data?.tx_ref ?? payload?.data?.reference ?? null;
  }
}
