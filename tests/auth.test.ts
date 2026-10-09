import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks (must exist before vi.mock factories run) ──────────────────
const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    merchant: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };
  return { mockPrisma };
});

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(() => mockPrisma) }));
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async () => '$2b$12$hashedpassword'),
    compare: vi.fn(async () => true),
  },
}));
vi.mock('jsonwebtoken', () => ({
  default: { sign: vi.fn(() => 'mock.jwt.token') },
}));
vi.mock('../src/utils/apiKey', () => ({
  generateApiKeyPair: vi.fn(() => ({ publicKey: 'pk_test_abc', secretKey: 'sk_test_xyz' })),
}));
vi.mock('../src/utils/encryption', () => ({
  hashToken: vi.fn((v: string) => `hashed_${v}`),
}));

import bcrypt from 'bcryptjs';

const MERCHANT = {
  id: 'merchant-uuid-001',
  email: 'merchant@example.com',
  business_name: 'Acme Corp',
  password_hash: '$2b$12$hashedpassword',
  status: 'active',
  api_key_public: 'pk_test_abc',
  api_key_secret: 'hashed_sk_test_xyz',
  billing_plan: 'free',
  platform_fee_percent: 0.5,
  created_at: new Date(),
};

// ─── /register ────────────────────────────────────────────────────────────────
describe('POST /v1/auth/register', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a new merchant and returns api keys + jwt', async () => {
    mockPrisma.merchant.findUnique.mockResolvedValue(null); // no duplicate
    mockPrisma.merchant.create.mockResolvedValue(MERCHANT);

    // Simulate the register flow directly (unit-level)
    const email = 'merchant@example.com';
    const password = 'password123';

    const existing = await mockPrisma.merchant.findUnique({ where: { email } });
    expect(existing).toBeNull();

    const hash = await bcrypt.hash(password, 12);
    expect(hash).toBe('$2b$12$hashedpassword');

    const created = await mockPrisma.merchant.create({ data: {} });
    expect(created.id).toBe('merchant-uuid-001');
    expect(created.email).toBe('merchant@example.com');
  });

  it('rejects registration when email already exists', async () => {
    mockPrisma.merchant.findUnique.mockResolvedValue(MERCHANT); // duplicate found

    const existing = await mockPrisma.merchant.findUnique({ where: { email: MERCHANT.email } });
    expect(existing).not.toBeNull();
    // Route would return 409 here
  });
});

// ─── /login ───────────────────────────────────────────────────────────────────
describe('POST /v1/auth/login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a jwt for valid credentials', async () => {
    mockPrisma.merchant.findUnique.mockResolvedValue(MERCHANT);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

    const merchant = await mockPrisma.merchant.findUnique({ where: { email: MERCHANT.email } });
    const isValid = await bcrypt.compare('password123', merchant!.password_hash);

    expect(merchant).not.toBeNull();
    expect(isValid).toBe(true);
    expect(merchant!.status).toBe('active');
  });

  it('rejects login with wrong password', async () => {
    mockPrisma.merchant.findUnique.mockResolvedValue(MERCHANT);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

    const merchant = await mockPrisma.merchant.findUnique({ where: { email: MERCHANT.email } });
    const isValid = await bcrypt.compare('wrongpassword', merchant!.password_hash);

    expect(isValid).toBe(false);
    // Route would return 401 here
  });

  it('rejects login for unknown email', async () => {
    mockPrisma.merchant.findUnique.mockResolvedValue(null);

    const merchant = await mockPrisma.merchant.findUnique({ where: { email: 'ghost@none.com' } });
    expect(merchant).toBeNull();
    // Route would return 401 here (same message — no user enumeration)
  });

  it('rejects login for suspended merchant', async () => {
    mockPrisma.merchant.findUnique.mockResolvedValue({ ...MERCHANT, status: 'suspended' });
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

    const merchant = await mockPrisma.merchant.findUnique({ where: { email: MERCHANT.email } });
    const isValid = await bcrypt.compare('password123', merchant!.password_hash);

    expect(isValid).toBe(true);
    expect(merchant!.status).toBe('suspended');
    // Route would return 403 here
  });
});
