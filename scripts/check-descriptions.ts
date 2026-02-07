import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function check() {
  const count = await prisma.book.count({ 
    where: { description: { not: null } } 
  });
  console.log('Books with descriptions:', count);
  
  const sample = await prisma.book.findFirst({ 
    where: { description: { not: null } },
    select: { title: true, description: true }
  });
  
  if (sample) {
    console.log('\nSample:');
    console.log(sample.title);
    console.log(sample.description?.substring(0, 150) + '...');
  }
  
  await prisma.$disconnect();
  await pool.end();
}

check();