import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { fmtDateTime } from '@/lib/format';
import { Card, CardBody, CardHeader, PageHeader, Badge } from '@/components/ui';
import { MfaSection } from './mfa-section';
import { revokeOtherSessions } from '@/app/(auth)/actions';
import { SubmitButton } from '@/components/ui/client';

export const metadata: Metadata = { title: 'Security & sessions' };

export default async function SecurityPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const sessions = await db.session.findMany({
    where: { userId: session.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Security & sessions" description="Manage two-factor authentication and your active sessions." />
      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Two-factor authentication"
            description="Adds a 6-digit code from an authenticator app when you sign in."
          />
          <CardBody>
            <MfaSection enabled={session.user.mfaEnabled} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Active sessions"
            actions={
              <form
                action={async () => {
                  'use server';
                  await revokeOtherSessions();
                }}
              >
                <SubmitButton variant="secondary" size="sm">
                  Sign out other sessions
                </SubmitButton>
              </form>
            }
          />
          <ul className="divide-y divide-ink-100">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <div>
                  <div className="text-ink-800">
                    {s.userAgent ? s.userAgent.split(')')[0].split('(').pop() : 'Unknown device'}
                  </div>
                  <div className="text-[12px] text-ink-400">
                    Started {fmtDateTime(s.createdAt)} {s.ip ? `· ${s.ip}` : ''}
                  </div>
                </div>
                {s.id === session.id ? <Badge tone="green">This session</Badge> : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
