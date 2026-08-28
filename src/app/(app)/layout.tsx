import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requireCtx, can } from '@/lib/authz';
import { filterNav } from '@/lib/nav';
import { SideNav } from '@/components/shell/SideNav';
import { TopBar } from '@/components/shell/TopBar';
import { signOut } from '@/app/(auth)/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();

  const [unreadCount, worker, org] = await Promise.all([
    db.notification.count({ where: { userId: ctx.userId, readAt: null } }),
    ctx.workerId
      ? db.worker.findUnique({
          where: { id: ctx.workerId },
          select: { preferredName: true, legalFirstName: true, lastName: true },
        })
      : Promise.resolve(null),
    db.organization.findFirst({ select: { setupCompletedAt: true } }),
  ]);

  // First run: super admins are routed into the setup wizard.
  if (!org?.setupCompletedAt && can(ctx, 'settings.admin')) {
    redirect('/setup');
  }

  const isManager = ctx.workerId
    ? (await db.employmentRecord.count({ where: { managerId: ctx.workerId, effectiveTo: null } })) > 0
    : false;

  const groups = filterNav(ctx.permissions, isManager);
  const userName = worker ? `${worker.preferredName || worker.legalFirstName} ${worker.lastName}` : ctx.email;

  return (
    <div className="min-h-screen">
      <SideNav groups={groups} />
      <div className="lg:pl-60">
        <TopBar
          userName={userName}
          userEmail={ctx.email}
          workerId={ctx.workerId}
          unreadCount={unreadCount}
          signOutAction={signOut}
        />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
