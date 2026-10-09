import { Request, Response, NextFunction } from 'express';
import type { Merchant } from '@prisma/client';
import { hashToken } from '../utils/encryption';
import prisma from '../lib/prisma';

export interface AuthenticatedRequest extends Request {
  merchant?: Merchant;
}


export const authenticateApiKey = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ status: 'error', message: 'Missing or invalid authorization header' });
  }

  const secretKey = authHeader.split(' ')[1];
  const hashedSecretKey = hashToken(secretKey);

  try {
    const merchant = await prisma.merchant.findFirst({
      where: { api_key_secret: hashedSecretKey, status: 'active' },
    });

    if (!merchant) {
      return res.status(401).json({ status: 'error', message: 'Invalid API key or inactive merchant' });
    }

    req.merchant = merchant;
    next();
  } catch (error) {
    next(error);
  }
};
