/**
 * Sync system roles and their permission grants from the catalog into the
 * database.
 *
 * Adding a permission to src/lib/authz/catalog.ts changes the code but not the
 * RolePermission rows an existing database already has, so a new permission
 * would be defined and granted to nobody. This closes that gap and is safe to
 * run on every deploy.
 *
 * It is deliberately ADDITIVE. It grants what a role definition says it should
 * have and never removes a grant, because an administrator may have tailored a
 * role in Settings and a deploy should not quietly undo that. Removing a
 * permission from a role stays a deliberate action in the UI.
 *
 * Usage: npx tsx scripts/sync-roles.ts
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ROLE_DEFS, PERMISSIONS } from '../src/lib/authz/catalog';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  let rolesCreated = 0;
  let grantsAdded = 0;
  const added: string[] = [];

  for (const def of ROLE_DEFS) {
    const existing = await db.role.findUnique({ where: { key: def.key } });
    const role = existing
      ? await db.role.update({
          where: { key: def.key },
          data: { name: def.name, description: def.description },
        })
      : await db.role.create({
          data: { key: def.key, name: def.name, description: def.description, system: true },
        });
    if (!existing) rolesCreated += 1;

    const held = new Set(
      (await db.rolePermission.findMany({ where: { roleId: role.id }, select: { permission: true } }))
        .map((p) => p.permission),
    );
    for (const permission of def.permissions) {
      if (held.has(permission)) continue;
      await db.rolePermission.create({ data: { roleId: role.id, permission } });
      grantsAdded += 1;
      added.push(`${def.key} → ${permission}`);
    }
  }

  // Warn about grants for permissions that no longer exist in the catalog.
  // These are inert — can() only answers for catalog permissions — but they
  // are worth cleaning up by hand.
  const known = new Set(Object.keys(PERMISSIONS));
  const stale = await db.rolePermission.findMany({
    where: { permission: { notIn: [...known] } },
    include: { role: { select: { key: true } } },
  });

  console.log(`Roles created: ${rolesCreated}`);
  console.log(`Permission grants added: ${grantsAdded}`);
  for (const line of added) console.log(`  + ${line}`);
  if (stale.length > 0) {
    console.log(`\n${stale.length} grant(s) reference a permission no longer in the catalog (inert, remove by hand):`);
    for (const s of stale) console.log(`  ? ${s.role.key} → ${s.permission}`);
  }
  await db.$disconnect();
}

main();
