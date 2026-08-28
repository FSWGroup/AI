import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { Callout, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { PreferencesForm } from './preferences-form';

export const metadata: Metadata = { title: 'Notification preferences' };

export default async function NotificationPrefsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const user = await db.user.findUniqueOrThrow({ where: { id: session.user.id } });
  const prefs = (user.notificationPrefs ?? {}) as Record<string, boolean>;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Notification preferences" description="In-app notifications always appear; these control email." />
      <Card>
        <CardHeader title="Email me about…" />
        <CardBody className="space-y-4">
          <PreferencesForm
            emailTasks={prefs.emailTasks !== false}
            emailApprovals={prefs.emailApprovals !== false}
            emailGeneral={prefs.emailGeneral !== false}
          />
          <Callout tone="info">
            Compliance-critical notifications (required training, work authorization, policy deadlines) are always sent
            regardless of these settings, because business policy requires that you receive them.
          </Callout>
        </CardBody>
      </Card>
    </div>
  );
}
