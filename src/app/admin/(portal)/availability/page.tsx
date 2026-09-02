import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { SectionHeading } from "@/components/ui";
import { AvailabilityEditor } from "@/components/admin/AvailabilityEditor";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");

  const [rules, exceptions, me] = await Promise.all([
    prisma.availabilityRule.findMany({
      where: { userId: user.id, active: true },
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    }),
    prisma.availabilityException.findMany({
      where: { userId: user.id, date: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      orderBy: { date: "asc" },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { timeZone: true },
    }),
  ]);

  const upcoming = await prisma.interview.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { gte: new Date() },
      participants: { some: { userId: user.id } },
    },
    include: {
      application: {
        include: {
          candidate: { select: { firstName: true, lastName: true } },
          requisition: { select: { title: true } },
        },
      },
    },
    orderBy: { scheduledAt: "asc" },
    take: 20,
  });

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHeading
        eyebrow="Scheduling"
        title="When you can interview"
        description="Candidates pick from the times every required interviewer is free. Nothing is offered unless everyone who has to be there can be."
      />

      <AvailabilityEditor
        timeZone={me.timeZone}
        rules={rules.map((r) => ({
          dayOfWeek: r.dayOfWeek,
          startMinute: r.startMinute,
          endMinute: r.endMinute,
        }))}
        exceptions={exceptions.map((e) => ({
          id: e.id,
          date: e.date.toISOString().slice(0, 10),
          startMinute: e.startMinute,
          endMinute: e.endMinute,
          available: e.available,
          reason: e.reason,
        }))}
        upcoming={upcoming.map((i) => ({
          id: i.id,
          title: i.title,
          candidate: `${i.application.candidate.firstName} ${i.application.candidate.lastName}`,
          role: i.application.requisition.title,
          scheduledAt: i.scheduledAt.toISOString(),
          durationMinutes: i.durationMinutes,
        }))}
      />
    </div>
  );
}
