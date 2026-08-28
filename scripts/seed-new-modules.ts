/**
 * Adds demo data for the modules added after the initial seed — skills,
 * break rules, shifts, an access profile and a comp cycle — to a database
 * that already has the base demo data.
 *
 * Idempotent and additive: it creates nothing that already exists and deletes
 * nothing. Safe to re-run.
 *
 * Usage: npx tsx scripts/seed-new-modules.ts
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const admin = await db.user.findFirstOrThrow({ where: { email: 'admin@fswelsford.com' } });
  const warehouseDept = await db.department.findFirst({ where: { name: 'Warehouse' } });
  const exton = await db.location.findFirst({ where: { name: { contains: 'Exton' } } });

  // --- Skills ---------------------------------------------------------------
  const skillSpecs = [
    { name: 'Forklift operation (sit-down)', category: 'EQUIPMENT', isCertification: true, isCritical: true, validityMonths: 36 },
    { name: 'OSHA 30 (General Industry)', category: 'SAFETY', isCertification: true, isCritical: true, validityMonths: 60 },
    { name: 'Prophet 21', category: 'SYSTEM', isCertification: false, isCritical: false, validityMonths: null },
    { name: 'Valve sizing & selection', category: 'PRODUCT', isCertification: false, isCritical: true, validityMonths: null },
  ];
  const skills = new Map<string, string>();
  for (const spec of skillSpecs) {
    const skill = await db.skill.upsert({ where: { name: spec.name }, create: spec, update: {} });
    skills.set(spec.name, skill.id);
  }

  const warehouseWorker = await db.worker.findFirst({
    where: { employments: { some: { departmentId: warehouseDept?.id ?? undefined, effectiveTo: null } }, status: 'ACTIVE' },
  });
  const opsLead = await db.worker.findFirst({ where: { employments: { some: { title: { contains: 'VP Operations' } } } } });

  if (warehouseWorker) {
    // One verified holder → single point of failure on the forklift.
    await db.workerSkill.upsert({
      where: { workerId_skillId: { workerId: warehouseWorker.id, skillId: skills.get('Forklift operation (sit-down)')! } },
      create: {
        workerId: warehouseWorker.id,
        skillId: skills.get('Forklift operation (sit-down)')!,
        level: 4,
        verifiedById: admin.id,
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 21 * 86_400_000),
        note: '[DEMO] Renewal due — booked with the training vendor.',
      },
      update: {},
    });
  }
  if (opsLead) {
    // The only OSHA 30 holder has lapsed → uncovered.
    await db.workerSkill.upsert({
      where: { workerId_skillId: { workerId: opsLead.id, skillId: skills.get('OSHA 30 (General Industry)')! } },
      create: {
        workerId: opsLead.id,
        skillId: skills.get('OSHA 30 (General Industry)')!,
        level: 4,
        verifiedById: admin.id,
        verifiedAt: new Date(Date.now() - 60 * 86_400_000),
        expiresAt: new Date(Date.now() - 30 * 86_400_000),
        note: '[DEMO] Lapsed — renewal not yet scheduled.',
      },
      update: {},
    });
  }

  // --- Break rules ----------------------------------------------------------
  if ((await db.breakRule.count()) === 0) {
    await db.breakRule.createMany({
      data: [
        {
          jurisdiction: 'US-PA', name: 'Minors: 30-minute meal after 5 hours',
          afterMinutes: 300, breakMinutes: 30, kind: 'MEAL', paid: false, appliesToMinors: true,
          sourceUrl: 'https://www.dli.pa.gov/Individuals/Labor-Management-Relations/llc/Pages/Child-Labor-Act.aspx',
          note: '[DEMO] Pennsylvania mandates meal periods for minors; adult meal breaks are not required by state law.',
        },
        {
          jurisdiction: 'US-CA', name: '30-minute unpaid meal after 5 hours',
          afterMinutes: 300, breakMinutes: 30, kind: 'MEAL', paid: false,
          sourceUrl: 'https://www.dir.ca.gov/dlse/faq_mealperiods.htm', note: '[DEMO]',
        },
        {
          jurisdiction: 'PH', name: '60-minute unpaid meal after 5 hours',
          afterMinutes: 300, breakMinutes: 60, kind: 'MEAL', paid: false,
          sourceUrl: 'https://www.dole.gov.ph/', note: '[DEMO] Confirm with local counsel.',
        },
      ],
    });
  }

  // --- A published week of shifts -------------------------------------------
  if (warehouseWorker && (await db.shift.count()) === 0) {
    const monday = new Date();
    monday.setUTCHours(0, 0, 0, 0);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    for (let i = 0; i < 5; i++) {
      const date = new Date(monday.getTime() + i * 86_400_000);
      const shift = await db.shift.create({
        data: {
          locationId: exton?.id ?? null,
          departmentId: warehouseDept?.id ?? null,
          date,
          startsAt: new Date(date.getTime() + 6 * 3_600_000),
          endsAt: new Date(date.getTime() + 14.5 * 3_600_000),
          breakMinutes: i === 2 ? 15 : 30,
          role: 'Picker',
          status: 'PUBLISHED',
          publishedAt: new Date(),
          note: i === 2 ? '[DEMO] Short break — shows in the break rule findings.' : null,
        },
      });
      await db.shiftAssignment.create({ data: { shiftId: shift.id, workerId: warehouseWorker.id } });
    }
  }

  // --- An access profile ----------------------------------------------------
  const p21 = await db.softwareApp.findFirst({ where: { name: { contains: 'Prophet' } } });
  if (warehouseDept && (await db.accessProfile.count()) === 0) {
    const profile = await db.accessProfile.create({
      data: {
        name: 'Warehouse Associate',
        description: '[DEMO] What a warehouse hire gets on day one.',
        criteria: { departmentIds: [warehouseDept.id], workerTypes: ['EMPLOYEE'] },
      },
    });
    if (p21) {
      await db.accessProfileItem.create({ data: { profileId: profile.id, appId: p21.id, accessLevel: 'USER' } });
    }
  }

  // --- A comp cycle in planning ---------------------------------------------
  if ((await db.compCycle.count()) === 0) {
    const year = new Date().getUTCFullYear() + 1;
    await db.compCycle.create({
      data: {
        name: `FY${String(year).slice(2)} merit review`,
        status: 'DRAFT',
        effectiveDate: new Date(Date.UTC(year, 0, 1)),
        budgetPct: 3.5,
        eligibility: { minTenureMonths: 6, workerTypes: ['EMPLOYEE'] },
        guidance: '[DEMO] Prioritise people below band midpoint and anyone flagged in workforce analytics.',
      },
    });
  }

  console.log(
    `Ready: ${await db.skill.count()} skills, ${await db.breakRule.count()} break rules, ` +
      `${await db.shift.count()} shifts, ${await db.accessProfile.count()} access profiles, ` +
      `${await db.compCycle.count()} comp cycles.`,
  );
  await db.$disconnect();
}

main();
