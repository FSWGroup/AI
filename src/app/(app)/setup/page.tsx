import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { SetupWizard } from './setup-wizard';

export const metadata: Metadata = { title: 'Set up FSW People' };

/**
 * First-run setup wizard (§70). Pre-populated with sensible FSW Group
 * defaults so the application is usable immediately, but every value stays
 * editable here and later in Settings.
 */
export default async function SetupPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'settings.admin');

  const org = await db.organization.findFirst();
  if (org?.setupCompletedAt) redirect('/');

  const [entities, departments, locations, calendars, policies, templates] = await Promise.all([
    db.legalEntity.count(),
    db.department.count(),
    db.location.count(),
    db.holidayCalendar.count(),
    db.ptoPolicy.count(),
    db.lifecycleTemplate.count(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Welcome to FSW People"
        description="A few decisions and you're running. Everything here can be changed later in Settings."
      />
      <Card>
        <CardHeader title="Set up your organization" description="Defaults are pre-filled for FSW Group — adjust anything that doesn't fit." />
        <CardBody>
          <SetupWizard
            existing={{
              orgName: org?.name ?? 'FSW Group',
              entities,
              departments,
              locations,
              calendars,
              policies,
              templates,
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
