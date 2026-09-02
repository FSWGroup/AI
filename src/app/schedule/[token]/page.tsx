import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { SchedulePicker } from "@/components/careers/SchedulePicker";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Choose a time",
  robots: { index: false, follow: false },
};

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [request, settings] = await Promise.all([
    prisma.schedulingRequest.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        application: {
          include: {
            candidate: { select: { firstName: true } },
            requisition: { select: { title: true } },
          },
        },
      },
    }),
    prisma.orgSettings.findUnique({ where: { id: "org" } }),
  ]);
  const company = settings?.companyName ?? "FSW Group";

  if (!request) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">
            This link is no longer active
          </h1>
          <p className="mt-3 leading-relaxed text-navy-600">
            Please contact your recruiting contact at {company} and they will
            send you a new one.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-6 py-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-fsw-600">
        {company}
      </p>
      <h1 className="mt-1 text-2xl font-bold text-navy-900">{request.title}</h1>
      <p className="mt-1 text-sm text-navy-500">
        For {request.application.requisition.title} ·{" "}
        {request.durationMinutes} minutes
      </p>
      <SchedulePicker
        token={token}
        firstName={request.application.candidate.firstName}
        company={company}
      />
    </main>
  );
}
