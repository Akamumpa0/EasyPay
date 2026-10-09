import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EasyPayError, EasyPayErrorCode } from '../src/utils/errors';
import { NormalizedChargeResult } from '../src/providers/ChargeProvider';

// ---------------------------------------------------------------------------
// vi.hoisted() ensures these objects exist before vi.mock factories run
// ---------------------------------------------------------------------------
const { mockPrisma, mockRegistry } = vi.hoisted(() => {
  const mockPrisma = {
    provider: { findMany: vi.fn() },
    merchantProviderCredential: { findMany: vi.fn() },
  };
  const mockRegistry = { getProvider: vi.fn() };
  return { mockPrisma, mockRegistry };
});

// ---------------------------------------------------------------------------
// Mock all external dependencies BEFORE importing the module under test
// ---------------------------------------------------------------------------
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

vi.mock('../src/providers', () => ({
  providerRegistry: mockRegistry,
}));

vi.mock('../src/utils/encryption', () => ({
  decrypt: (val: string) => val,
  encrypt: (val: string) => val,
}));

// Now safe to import the module under test
import { ProviderRouter } from '../src/services/ProviderRouter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mockChargeResult(overrides: Partial<NormalizedChargeResult> = {}): NormalizedChargeResult {
  return {
    status: 'pending',
    provider: 'paystack',
    transaction_id: 'txn_mock_123',
    checkout_url: 'https://checkout.paystack.com/mock',
    raw: {},
    ...overrides,
  };
}

function buildMockProvider(name: string, chargeFn: () => Promise<NormalizedChargeResult>) {
  return {
    name,
    charge: vi.fn(chargeFn),
    refund: vi.fn(),
    verifyWebhookSignature: vi.fn(() => true),
    parseWebhookEvent: vi.fn(),
    extractTransactionReference: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const DB_PROVIDERS = [
  { id: 'prov_1', name: 'paystack',    priority: 1, supported_currencies: ['NGN', 'USD'] },
  { id: 'prov_2', name: 'flutterwave', priority: 2, supported_currencies: ['NGN', 'USD'] },
];

const MERCHANT_ID = 'merchant_test_001';

const DB_CREDENTIALS = [
  { merchant_id: MERCHANT_ID, provider_id: 'prov_1', encrypted_api_key: 'pk_ps', encrypted_secret_key: 'sk_ps', is_live_mode: false },
  { merchant_id: MERCHANT_ID, provider_id: 'prov_2', encrypted_api_key: 'pk_fw', encrypted_secret_key: 'sk_fw', is_live_mode: false },
];

const CHARGE_PARAMS = {
  amount: 5000,
  currency: 'NGN',
  customer_email: 'test@example.com',
  idempotency_key: 'idem_001',
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('ProviderRouter', () => {
  let router: ProviderRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.provider.findMany.mockResolvedValue(DB_PROVIDERS);
    mockPrisma.merchantProviderCredential.findMany.mockResolvedValue(DB_CREDENTIALS);
    router = new ProviderRouter();
  });

  it('should successfully charge with the primary (highest-priority) provider', async () => {
    const paystackMock = buildMockProvider('paystack', async () =>
      mockChargeResult({ provider: 'paystack' })
    );
    mockRegistry.getProvider.mockReturnValue(paystackMock);

    const { result } = await router.routeCharge(CHARGE_PARAMS, MERCHANT_ID);

    expect(result.provider).toBe('paystack');
    expect(result.status).toBe('pending');
    expect(paystackMock.charge).toHaveBeenCalledOnce();
  });

  it('should failover to secondary provider when primary throws', async () => {
    const paystackMock = buildMockProvider('paystack', async () => {
      throw new EasyPayError(EasyPayErrorCode.PROVIDER_ERROR, 'Paystack is down');
    });
    const flutterwaveMock = buildMockProvider('flutterwave', async () =>
      mockChargeResult({ provider: 'flutterwave', transaction_id: 'txn_flw_456' })
    );

    mockRegistry.getProvider
      .mockReturnValueOnce(paystackMock)
      .mockReturnValueOnce(flutterwaveMock);

    const { result } = await router.routeCharge(CHARGE_PARAMS, MERCHANT_ID);

    expect(result.provider).toBe('flutterwave');
    expect(result.transaction_id).toBe('txn_flw_456');
    expect(paystackMock.charge).toHaveBeenCalledOnce();
    expect(flutterwaveMock.charge).toHaveBeenCalledOnce();
  });

  it('should throw EasyPayError when ALL providers fail', async () => {
    const paystackMock = buildMockProvider('paystack', async () => {
      throw new EasyPayError(EasyPayErrorCode.PROVIDER_ERROR, 'Paystack is down');
    });
    const flutterwaveMock = buildMockProvider('flutterwave', async () => {
      throw new EasyPayError(EasyPayErrorCode.PROVIDER_ERROR, 'Flutterwave is down');
    });

    mockRegistry.getProvider
      .mockReturnValueOnce(paystackMock)
      .mockReturnValueOnce(flutterwaveMock);

    await expect(router.routeCharge(CHARGE_PARAMS, MERCHANT_ID)).rejects.toBeInstanceOf(EasyPayError);
    expect(paystackMock.charge).toHaveBeenCalledOnce();
    expect(flutterwaveMock.charge).toHaveBeenCalledOnce();
  });

  it('should honour preferred_provider by putting it first in attempt order', async () => {
    const callOrder: string[] = [];

    const paystackMock = buildMockProvider('paystack', async () => {
      callOrder.push('paystack');
      return mockChargeResult({ provider: 'paystack' });
    });
    const flutterwaveMock = buildMockProvider('flutterwave', async () => {
      callOrder.push('flutterwave');
      return mockChargeResult({ provider: 'flutterwave' });
    });

    mockRegistry.getProvider.mockImplementation((name: string) => {
      if (name === 'flutterwave') return flutterwaveMock;
      return paystackMock;
    });

    const { result } = await router.routeCharge(CHARGE_PARAMS, MERCHANT_ID, 'flutterwave');

    expect(callOrder[0]).toBe('flutterwave');
    expect(result.provider).toBe('flutterwave');
  });

  it('should throw when no providers support the requested currency', async () => {
    mockPrisma.provider.findMany.mockResolvedValue([]);

    await expect(
      router.routeCharge({ ...CHARGE_PARAMS, currency: 'JPY' }, MERCHANT_ID)
    ).rejects.toThrow();
  });

  it('should throw when merchant has no configured credentials', async () => {
    mockPrisma.merchantProviderCredential.findMany.mockResolvedValue([]);

    await expect(router.routeCharge(CHARGE_PARAMS, MERCHANT_ID)).rejects.toThrow();
  });
});
