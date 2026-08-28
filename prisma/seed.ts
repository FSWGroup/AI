import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { ROLE_DEFS } from '../src/lib/authz/catalog';
import { seedDemoData } from './seed-demo';

/**
 * Seed: roles/permissions, organization scaffolding, holiday calendars,
 * a Super Admin account, and clearly-labeled fictional demo data.
 *
 * Demo sign-in (see README):
 *   admin@fswelsford.com / FswPeople!Demo2026
 * All demo people are fictional; no real SSNs, bank accounts or government
 * identifiers are ever seeded.
 */

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

export const DEMO_PASSWORD = 'FswPeople!Demo2026';

async function main() {
  console.log('Seeding roles & permissions…');
  for (const def of ROLE_DEFS) {
    const role = await db.role.upsert({
      where: { key: def.key },
      create: { key: def.key, name: def.name, description: def.description, system: true },
      update: { name: def.name, description: def.description },
    });
    for (const permission of def.permissions) {
      await db.rolePermission.upsert({
        where: { roleId_permission: { roleId: role.id, permission } },
        create: { roleId: role.id, permission },
        update: {},
      });
    }
  }

  console.log('Seeding organization…');
  let org = await db.organization.findFirst();
  if (!org) {
    org = await db.organization.create({ data: { name: 'FSW Group' } });
  }

  const fsw = await db.legalEntity.upsert({
    where: { code: 'FSW' },
    create: { organizationId: org.id, name: 'FS Welsford', code: 'FSW', country: 'US' },
    update: {},
  });
  const vlv = await db.legalEntity.upsert({
    where: { code: 'VLV' },
    create: { organizationId: org.id, name: 'ValveMan', code: 'VLV', country: 'US' },
    update: {},
  });

  const departments = ['Executive', 'Sales', 'Operations', 'Warehouse', 'Accounting & Finance', 'Customer Service & E-Commerce', 'Application Engineering', 'Human Resources', 'IT'];
  const deptMap = new Map<string, string>();
  for (const name of departments) {
    const d = await db.department.upsert({ where: { name }, create: { name }, update: {} });
    deptMap.set(name, d.id);
  }

  const exton = await db.location.upsert({
    where: { name: 'Exton HQ' },
    create: {
      name: 'Exton HQ',
      street: '100 Industrial Way',
      city: 'Exton',
      state: 'PA',
      postal: '19341',
      country: 'US',
      timezone: 'America/New_York',
    },
    update: {},
  });
  const remotePh = await db.location.upsert({
    where: { name: 'Philippines — Remote' },
    create: { name: 'Philippines — Remote', country: 'PH', timezone: 'Asia/Manila' },
    update: {},
  });

  console.log('Seeding holiday calendars…');
  const usCal = await db.holidayCalendar.upsert({
    where: { name: 'United States' },
    create: { name: 'United States', country: 'US' },
    update: {},
  });
  const phCal = await db.holidayCalendar.upsert({
    where: { name: 'Philippines' },
    create: { name: 'Philippines', country: 'PH' },
    update: {},
  });
  const year = new Date().getUTCFullYear();
  const usHolidays: [string, string][] = [
    [`${year}-01-01`, "New Year's Day"],
    [`${year}-05-25`, 'Memorial Day'],
    [`${year}-07-03`, 'Independence Day (observed)'],
    [`${year}-09-07`, 'Labor Day'],
    [`${year}-11-26`, 'Thanksgiving'],
    [`${year}-11-27`, 'Day after Thanksgiving'],
    [`${year}-12-25`, 'Christmas Day'],
  ];
  const phHolidays: [string, string][] = [
    [`${year}-01-01`, "New Year's Day"],
    [`${year}-04-09`, 'Araw ng Kagitingan'],
    [`${year}-05-01`, 'Labor Day'],
    [`${year}-06-12`, 'Independence Day'],
    [`${year}-08-31`, 'National Heroes Day'],
    [`${year}-11-30`, 'Bonifacio Day'],
    [`${year}-12-25`, 'Christmas Day'],
    [`${year}-12-30`, 'Rizal Day'],
  ];
  for (const [date, name] of usHolidays) {
    await db.holiday.upsert({
      where: { calendarId_date_name: { calendarId: usCal.id, date: new Date(date), name } },
      create: { calendarId: usCal.id, date: new Date(date), name },
      update: {},
    });
  }
  for (const [date, name] of phHolidays) {
    await db.holiday.upsert({
      where: { calendarId_date_name: { calendarId: phCal.id, date: new Date(date), name } },
      create: { calendarId: phCal.id, date: new Date(date), name },
      update: {},
    });
  }

  console.log('Seeding Super Admin…');
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const adminUser = await db.user.upsert({
    where: { email: 'admin@fswelsford.com' },
    create: { email: 'admin@fswelsford.com', passwordHash, status: 'ACTIVE' },
    update: {},
  });
  const superAdminRole = await db.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
  await db.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: superAdminRole.id } },
    create: { userId: adminUser.id, roleId: superAdminRole.id },
    update: {},
  });

  await seedDemoData(db, {
    orgId: org.id,
    entities: { fsw: fsw.id, vlv: vlv.id },
    departments: deptMap,
    locations: { exton: exton.id, remotePh: remotePh.id },
    adminUserId: adminUser.id,
    passwordHash,
  });

  // Demo installs skip the first-run wizard; fresh production installs
  // (seeded without demo data) are routed to /setup on first login.
  await db.organization.update({ where: { id: org.id }, data: { setupCompletedAt: new Date() } });

  console.log('Seed complete. Sign in as admin@fswelsford.com');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
