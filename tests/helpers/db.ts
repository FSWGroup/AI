import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { ROLE_DEFS } from '../../src/lib/authz/catalog';

export const testDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/** Wipe every table between test files, preserving schema and triggers. */
export async function resetDatabase() {
  const tables = await testDb.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  if (list) {
    // TRUNCATE bypasses the append-only triggers, which only guard UPDATE/DELETE.
    await testDb.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
}

export async function seedRoles() {
  for (const def of ROLE_DEFS) {
    const role = await testDb.role.upsert({
      where: { key: def.key },
      create: { key: def.key, name: def.name, description: def.description, system: true },
      update: {},
    });
    for (const permission of def.permissions) {
      await testDb.rolePermission.upsert({
        where: { roleId_permission: { roleId: role.id, permission } },
        create: { roleId: role.id, permission },
        update: {},
      });
    }
  }
}

export interface Fixture {
  orgId: string;
  entityId: string;
  departmentId: string;
  locationId: string;
}

export async function seedOrg(): Promise<Fixture> {
  const org = await testDb.organization.create({ data: { name: 'FSW Group', setupCompletedAt: new Date() } });
  const entity = await testDb.legalEntity.create({
    data: { organizationId: org.id, name: 'FS Welsford', code: 'FSW', country: 'US' },
  });
  const department = await testDb.department.create({ data: { name: 'Operations' } });
  const location = await testDb.location.create({
    data: { name: 'Exton HQ', city: 'Exton', state: 'PA', country: 'US', timezone: 'America/New_York' },
  });
  return { orgId: org.id, entityId: entity.id, departmentId: department.id, locationId: location.id };
}

/** Create a user + worker with the given roles, returning both ids. */
export async function makeWorker(opts: {
  fixture: Fixture;
  email: string;
  first?: string;
  last?: string;
  roleKeys: string[];
  managerId?: string | null;
  workerType?: 'EMPLOYEE' | 'CONTRACTOR';
  country?: string;
  title?: string;
  hireDate?: Date;
  amount?: number;
}) {
  const roles = await testDb.role.findMany({ where: { key: { in: opts.roleKeys } } });
  const user = await testDb.user.create({
    data: {
      email: opts.email,
      passwordHash: await bcrypt.hash('TestPassword!123', 4),
      status: 'ACTIVE',
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
  });
  const count = await testDb.worker.count();
  const worker = await testDb.worker.create({
    data: {
      employeeNumber: `TST-${String(count + 1).padStart(4, '0')}`,
      userId: user.id,
      legalFirstName: opts.first ?? 'Test',
      lastName: opts.last ?? `Worker${count + 1}`,
      workEmail: opts.email,
      personalEmail: `personal-${count + 1}@example.com`,
      dateOfBirth: new Date('1990-05-15'),
      homeStreet: '1 Test Lane',
      workerType: opts.workerType ?? 'EMPLOYEE',
      status: 'ACTIVE',
      country: opts.country ?? 'US',
      hireDate: opts.hireDate ?? new Date('2023-01-09'),
      employments: {
        create: {
          legalEntityId: opts.fixture.entityId,
          departmentId: opts.fixture.departmentId,
          locationId: opts.fixture.locationId,
          managerId: opts.managerId ?? null,
          title: opts.title ?? 'Operations Associate',
          workState: 'PA',
          payBasis: 'SALARY',
          effectiveFrom: opts.hireDate ?? new Date('2023-01-09'),
          changeReason: 'HIRE',
        },
      },
      compensations: {
        create: {
          amount: opts.amount ?? 70000,
          currency: 'USD',
          rateType: 'ANNUAL',
          reason: 'HIRE',
          effectiveFrom: opts.hireDate ?? new Date('2023-01-09'),
        },
      },
    },
  });
  return { userId: user.id, workerId: worker.id };
}

/**
 * Build the same Ctx shape the app derives from a session, so service-layer
 * tests exercise the real permission logic.
 */
export async function ctxFor(userId: string) {
  const user = await testDb.user.findUniqueOrThrow({
    where: { id: userId },
    include: { roles: { include: { role: { include: { permissions: true } } } }, worker: true },
  });
  const permissions = new Set<string>();
  for (const ur of user.roles) for (const rp of ur.role.permissions) permissions.add(rp.permission);
  return {
    userId: user.id,
    email: user.email,
    sessionId: 'test-session',
    workerId: user.worker?.id ?? null,
    roleKeys: user.roles.map((r) => r.role.key),
    permissions,
    scopes: {},
  };
}
