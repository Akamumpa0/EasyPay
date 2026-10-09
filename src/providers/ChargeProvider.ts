export interface ChargeParams {
  amount: number;
  currency: string;
  customer_email: string;
  payment_method?: string;
  idempotency_key: string;
}

export interface NormalizedChargeResult {
  status: 'pending' | 'success' | 'failed' | 'reversed';
  provider: string;
  transaction_id: string;
  checkout_url?: string;
  provider_fee?: number;
  raw: any;
}

export interface NormalizedWebhookEvent {
  transaction_id: string;
  status: 'success' | 'failed' | 'reversed';
  provider_fee?: number;
  raw: any;
}

export interface ChargeProvider {
  name: string;
  charge(params: ChargeParams, credentials: { publicKey: string, secretKey: string, isLive: boolean }): Promise<NormalizedChargeResult>;
  refund(providerTransactionId: string, amount: number, credentials: { publicKey: string, secretKey: string, isLive: boolean }): Promise<{ status: string, provider_refund_id: string }>;
  verifyWebhookSignature(payload: Buffer | string, signature: string, secretKey: string): boolean;
  parseWebhookEvent(payload: any): NormalizedWebhookEvent;
  extractTransactionReference(payload: any): string | null;
}
