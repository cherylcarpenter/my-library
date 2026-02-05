import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL!;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function setup() {
  console.log('Creating EnrichmentStatus enum...');

  // Use DO block to create enum if not exists
  await prisma.$queryRaw`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EnrichmentStatus') THEN
        CREATE TYPE "EnrichmentStatus" AS ENUM ('PENDING', 'ENRICHED', 'NOT_FOUND', 'PARTIAL', 'FAILED');
      END IF;
    END
    $$
  `;

  console.log('Fixing enrichmentStatus column type...');

  // Drop and recreate column with proper enum type
  await prisma.$queryRaw`ALTER TABLE "Book" DROP COLUMN "enrichmentStatus"`;
  await prisma.$queryRaw`ALTER TABLE "Book" ADD COLUMN "enrichmentStatus" "EnrichmentStatus" DEFAULT 'PENDING'`;
  await prisma.$queryRaw`CREATE INDEX IF NOT EXISTS "Book_enrichmentStatus_idx" ON "Book"("enrichmentStatus")`;

  console.log('Column fixed!');
}

setup()
  .catch(console.error)
  .finally(() => process.exit(0));
