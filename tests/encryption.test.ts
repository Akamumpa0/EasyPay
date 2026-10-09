import { describe, it, expect, beforeAll, vi } from 'vitest';

// Inject a valid 64-hex-char key into env BEFORE the module is imported
process.env.DATABASE_URL = 'postgresql://user:pass@host/db?sslmode=require';
process.env.DIRECT_URL   = 'postgresql://user:pass@host/db?sslmode=require';
process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 64 valid hex chars for test
process.env.JWT_SECRET   = 'test-jwt-secret-that-is-at-least-32-chars-long!!';

import { encrypt, decrypt, hashToken } from '../src/utils/encryption';

describe('encrypt / decrypt', () => {
  it('round-trips a plain text string', () => {
    const original = 'sk_live_supersecretproviderkey';
    const ciphertext = encrypt(original);
    expect(ciphertext).not.toBe(original);
    expect(decrypt(ciphertext)).toBe(original);
  });

  it('produces different ciphertext each call (random IV)', () => {
    const text = 'same_input';
    expect(encrypt(text)).not.toBe(encrypt(text));
  });

  it('correctly decrypts text encrypted with the same key', () => {
    const values = ['hello world', '0', ' ', 'unicode-ñ'];
    for (const v of values) {
      expect(decrypt(encrypt(v))).toBe(v);
    }
  });
});

describe('hashToken', () => {
  it('returns a 64-char hex SHA-256 hash', () => {
    const hash = hashToken('sk_test_abc123');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic for the same input', () => {
    expect(hashToken('key')).toBe(hashToken('key'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToken('key1')).not.toBe(hashToken('key2'));
  });
});
