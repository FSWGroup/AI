/**
 * Development helper: list requisitions and admin accounts so a manual smoke
 * test of the Indeed flow can pick a real job id. Read-only.
 * Usage: npx tsx scripts/dev-inspect-jobs.ts
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const jobs = await db.jobRequisition.findMany({
    select: { id: true, title: true, status: true, description: true },
    take: 10,
  });
  for (const j of jobs) {
    console.log(`${j.status.padEnd(16)} ${j.id}  ${j.title}  description=${j.description ? 'yes' : 'no'}`);
  }
  const admins = await db.user.findMany({
    where: { roles: { some: { role: { key: { in: ['SUPER_ADMIN', 'HR_ADMIN'] } } } } },
    select: { email: true },
    take: 5,
  });
  console.log('Admin accounts:', admins.map((a) => a.email).join(', '));
  await db.$disconnect();
}

main();
