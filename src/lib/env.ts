import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

// Zod v4 uses `error` (not `required_error`) for missing field messages
const envSchema = z.object({
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string({ error: 'DATABASE_URL is required and must be a valid URL' }).url(),
  DIRECT_URL: z.string({ error: 'DIRECT_URL is required and must be a valid URL' }).url(),
  ENCRYPTION_KEY: z
    .string({ error: 'ENCRYPTION_KEY is required' })
    .length(64, 'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256)'),
  JWT_SECRET: z.string({ error: 'JWT_SECRET is required' }).min(32, 'JWT_SECRET must be at least 32 characters'),
  ALLOWED_ORIGINS: z.string().default(''),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Missing or invalid environment variables:\n');
  const issues = parsed.error.flatten().fieldErrors;
  for (const [key, messages] of Object.entries(issues)) {
    console.error(`  ${key}: ${(messages ?? []).join(', ')}`);
  }
  process.exit(1);
}

export const env = parsed.data;
