export interface PayoutParams {
  amount: number;
  currency: string;
  destination_account_number: string;
  destination_bank_code: string;
  idempotency_key: string;
}

export interface NormalizedPayoutResult {
  status: 'pending' | 'success' | 'failed';
  provider: string;
  provider_payout_id: string;
  raw: any;
}

export interface PayoutProvider {
  name: string;
  payout(params: PayoutParams, credentials: { publicKey: string, secretKey: string, isLive: boolean }): Promise<NormalizedPayoutResult>;
}
