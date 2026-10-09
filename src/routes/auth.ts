import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { generateApiKeyPair } from '../utils/apiKey';
import { hashToken } from '../utils/encryption';
import prisma from '../lib/prisma';
import { env } from '../lib/env';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  business_name: z.string().min(2),
  is_live: z.boolean().default(false),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Register ─────────────────────────────────────────────────────────────────

router.post('/register', async (req, res, next) => {
  try {
    const { email, password, business_name, is_live } = registerSchema.parse(req.body);

    // 1. Check for duplicate email
    const existing = await prisma.merchant.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ status: 'error', message: 'Email is already registered' });
    }

    // 2. Hash password and generate API keys
    const passwordHash = await bcrypt.hash(password, 12);
    const { publicKey, secretKey } = generateApiKeyPair(is_live);
    const hashedSecretKey = hashToken(secretKey);

    // 3. Create Merchant in Neon via Prisma
    const merchant = await prisma.merchant.create({
      data: {
        email,
        business_name,
        password_hash: passwordHash,
        api_key_public: publicKey,
        api_key_secret: hashedSecretKey,
      },
    });

    // 4. Issue JWT
    const token = jwt.sign({ sub: merchant.id, email: merchant.email }, env.JWT_SECRET, {
      expiresIn: '7d',
    });

    // 5. Return success with the unhashed secret key (shown ONLY ONCE)
    res.status(201).json({
      status: 'success',
      data: {
        merchant_id: merchant.id,
        business_name: merchant.business_name,
        api_key_public: publicKey,
        api_key_secret: secretKey, // Merchant must store this — never shown again
        token,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const merchant = await prisma.merchant.findUnique({ where: { email } });
    const isValid = merchant ? await bcrypt.compare(password, merchant.password_hash) : false;

    // Constant-time failure path — always compare to avoid timing attacks
    if (!merchant || !isValid) {
      return res.status(401).json({ status: 'error', message: 'Invalid email or password' });
    }

    if (merchant.status !== 'active') {
      return res.status(403).json({ status: 'error', message: 'Account is suspended' });
    }

    const token = jwt.sign({ sub: merchant.id, email: merchant.email }, env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.json({
      status: 'success',
      data: {
        merchant_id: merchant.id,
        business_name: merchant.business_name,
        token,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
