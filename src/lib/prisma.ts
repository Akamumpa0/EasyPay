import { PrismaClient } from '@prisma/client';

// Singleton Prisma instance — shared across all modules to avoid
// connection pool exhaustion from multiple PrismaClient instantiations.
const prisma = new PrismaClient();

export default prisma;
