import crypto from 'crypto';

export function generateApiKeyPair(isLive = false) {
  const mode = isLive ? 'live' : 'test';
  // Public key: used to identify the merchant (safe to expose)
  const publicKey = `pk_${mode}_${crypto.randomBytes(16).toString('hex')}`;
  // Secret key: used for authentication (must be kept secret)
  const secretKey = `sk_${mode}_${crypto.randomBytes(32).toString('hex')}`;

  return { publicKey, secretKey };
}
