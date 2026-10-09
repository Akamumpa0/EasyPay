import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { usageRecord: { findUnique: vi.fn() } },
}));

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(() => mockPrisma) }));
vi.mock('../src/utils/encryption', () => ({
  hashToken: (v: string) => v,
  decrypt: (v: string) => v,
  encrypt: (v: string) => v,
}));

import { checkTransactionLimit } from '../src/middlewares/billing';

function buildReq(billingPlan: string, merchantId = 'merchant-001') {
  return { merchant: { id: merchantId, billing_plan: billingPlan } } as any;
}

function buildRes() {
  const res = { status: vi.fn(), json: vi.fn() } as any;
  res.status.mockReturnValue(res);
  return res;
}

const currentPeriod = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();

describe('checkTransactionLimit middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  it('allows enterprise merchants to pass without checking usage', async () => {
    const req = buildReq('enterprise');
    const res = buildRes();

    await checkTransactionLimit(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mockPrisma.usageRecord.findUnique).not.toHaveBeenCalled();
  });

  it('allows free merchant under the 100-tx limit', async () => {
    mockPrisma.usageRecord.findUnique.mockResolvedValue({
      merchant_id: 'merchant-001',
      period: currentPeriod,
      transaction_count: 50,
    });

    await checkTransactionLimit(buildReq('free'), buildRes(), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('blocks free merchant AT the 100-tx limit', async () => {
    mockPrisma.usageRecord.findUnique.mockResolvedValue({
      merchant_id: 'merchant-001',
      period: currentPeriod,
      transaction_count: 100,
    });

    const res = buildRes();
    await checkTransactionLimit(buildReq('free'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows free merchant with no usage record yet (first tx of month)', async () => {
    mockPrisma.usageRecord.findUnique.mockResolvedValue(null);

    await checkTransactionLimit(buildReq('free'), buildRes(), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('allows pro merchant under the 1000-tx limit', async () => {
    mockPrisma.usageRecord.findUnique.mockResolvedValue({
      transaction_count: 999,
    });

    await checkTransactionLimit(buildReq('pro'), buildRes(), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('blocks pro merchant AT the 1000-tx limit', async () => {
    mockPrisma.usageRecord.findUnique.mockResolvedValue({
      transaction_count: 1000,
    });

    const res = buildRes();
    await checkTransactionLimit(buildReq('pro'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
