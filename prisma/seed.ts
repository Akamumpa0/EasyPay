import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱  Seeding providers...');

  await prisma.provider.upsert({
    where: { name: 'paystack' },
    update: {},
    create: {
      name: 'paystack',
      is_active: true,
      priority: 1,
      supported_currencies: ['NGN', 'USD', 'GHS', 'ZAR', 'KES'],
    },
  });

  await prisma.provider.upsert({
    where: { name: 'flutterwave' },
    update: {},
    create: {
      name: 'flutterwave',
      is_active: true,
      priority: 2,
      supported_currencies: ['NGN', 'USD', 'GHS', 'ZAR', 'KES', 'UGX', 'TZS', 'RWF', 'XOF', 'XAF', 'GBP', 'EUR'],
    },
  });

  console.log('✅  Providers seeded successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
