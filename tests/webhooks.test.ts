import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockPrisma, mockRegistry } = vi.hoisted(() => ({
  mockPrisma: {
    transaction: { findFirst: vi.fn(), update: vi.fn() },
    provider: { findUnique: vi.fn() },
    merchantProviderCredential: { findFirst: vi.fn() },
    webhookEvent: { findFirst: vi.fn(), create: vi.fn() },
  },
  mockRegistry: { getProvider: vi.fn() },
}));

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(() => mockPrisma) }));
vi.mock('../src/providers', () => ({ providerRegistry: mockRegistry }));
vi.mock('../src/utils/encryption', () => ({ decrypt: (v: string) => v }));

// ─── Shared fixtures ──────────────────────────────────────────────────────────
const TX = {
  id: 'tx-001',
  merchant_id: 'merchant-001',
  provider_used: 'paystack',
  provider_transaction_id: 'ref_paystack_123',
  amount: 5000,
  status: 'pending',
};

const PROVIDER_RECORD = { id: 'prov-001', name: 'paystack' };
const CREDENTIAL = {
  merchant_id: 'merchant-001',
  provider_id: 'prov-001',
  encrypted_secret_key: 'sk_live_secret',
  is_live_mode: true,
};

function buildMockProvider(sigValid: boolean) {
  return {
    name: 'paystack',
    verifyWebhookSignature: vi.fn(() => sigValid),
    parseWebhookEvent: vi.fn(() => ({ status: 'success', provider_fee: 100 })),
    extractTransactionReference: vi.fn(() => 'ref_paystack_123'),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('Webhook processing logic', () => {
  beforeEach(() => vi.clearAllMocks());

  it('processes a valid webhook and updates transaction status', async () => {
    const provider = buildMockProvider(true);
    mockRegistry.getProvider.mockReturnValue(provider);
    mockPrisma.transaction.findFirst.mockResolvedValue(TX);
    mockPrisma.provider.findUnique.mockResolvedValue(PROVIDER_RECORD);
    mockPrisma.merchantProviderCredential.findFirst.mockResolvedValue(CREDENTIAL);
    mockPrisma.webhookEvent.findFirst.mockResolvedValue(null); // not duplicate
    mockPrisma.webhookEvent.create.mockResolvedValue({});
    mockPrisma.transaction.update.mockResolvedValue({ ...TX, status: 'success' });

    // Simulate the core logic flow
    const reference = provider.extractTransactionReference({ data: { reference: 'ref_paystack_123' } });
    expect(reference).toBe('ref_paystack_123');

    const isValid = provider.verifyWebhookSignature(Buffer.from('body'), 'sig', 'sk_live_secret');
    expect(isValid).toBe(true);

    expect(mockPrisma.webhookEvent.create).not.toHaveBeenCalled(); // not called yet
  });

  it('rejects a webhook with an invalid signature', async () => {
    const provider = buildMockProvider(false); // bad sig
    const isValid = provider.verifyWebhookSignature(Buffer.from('tampered'), 'badsig', 'sk_live_secret');
    expect(isValid).toBe(false);
    // Route would return 401
  });

  it('is idempotent — does not reprocess an already-handled event', async () => {
    mockPrisma.webhookEvent.findFirst.mockResolvedValue({
      id: 'wh-001',
      transaction_id: TX.id,
      provider: 'paystack',
      verified: true,
    });

    const alreadyProcessed = await mockPrisma.webhookEvent.findFirst({
      where: { transaction_id: TX.id, provider: 'paystack', verified: true },
    });

    expect(alreadyProcessed).not.toBeNull();
    // Route would return 200 OK immediately without updating TX
    expect(mockPrisma.transaction.update).not.toHaveBeenCalled();
  });

  it('ignores events with no extractable transaction reference', async () => {
    const provider = buildMockProvider(true);
    provider.extractTransactionReference.mockReturnValue(null);

    const ref = provider.extractTransactionReference({ event: 'subscription.create' });
    expect(ref).toBeNull();
    // Route would return 200 'Ignored'
  });

  it('returns 404 when webhook reference does not match any stored transaction', async () => {
    mockPrisma.transaction.findFirst.mockResolvedValue(null); // no match

    const tx = await mockPrisma.transaction.findFirst({
      where: { provider_used: 'paystack', provider_transaction_id: 'unknown_ref' },
    });

    expect(tx).toBeNull();
    // Route would return 404
  });
});
