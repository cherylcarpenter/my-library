import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL environment variable is required. ' +
      'Please ensure it is set in your .env.local file.'
    );
  }
  
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  
  // Ensure we're passing a proper options object with correct types
  const options: Prisma.PrismaClientOptions = {
    adapter: adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
  
  return new PrismaClient(options);
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
