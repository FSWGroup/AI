import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, SectionHeading } from "@/components/ui";
import {
  CONSENT_LABEL,
  CONSENT_TONE,
  MIN_DAYS_BETWEEN_OUTREACH,
} from "@/lib/talent/consent";
import { TalentSearch } from "@/components/admin/TalentSearch";
import { NewPoolForm } from "@/components/admin/NewPoolForm";

export const dynamic = "force-dynamic";

export default async function TalentPage() {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "MANAGE_TALENT_POOL")) redirect("/admin");

  const [pools, tags, counts, openRequisitions, jobProfiles, suppressed] =
    await Promise.all([
      prisma.talentPool.findMany({
        include: {
          jobProfile: { select: { name: true } },
          _count: { select: { members: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.talentTag.findMany({
        include: { _count: { select: { profiles: true } } },
        orderBy: { label: "asc" },
      }),
      prisma.talentProfile.groupBy({
        by: ["consentStatus"],
        _count: { _all: true },
      }),
      prisma.requisition.findMany({
        where: { status: "OPEN" },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
      }),
      prisma.jobProfile.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.talentSuppression.count(),
    ]);

  const byStatus = new Map(counts.map((c) => [c.consentStatus, c._count._all]));

  return (
    <div className="mx-auto max-w-5xl">
      <SectionHeading
        eyebrow="Talent"
        title="People who nearly got the job"
        description="Already sourced, already assessed, already interested. Losing them because a requisition closed is the most expensive ordinary mistake in recruiting."
      />

      <p className="mt-4 rounded-lg bg-navy-50 p-4 text-sm text-navy-700">
        <span className="font-semibold text-navy-900">
          Applying is not consent.
        </span>{" "}
        Nobody appears here until they have been asked and said yes. Silence is
        not a yes, an opt-out is permanent and cannot be reversed from in here,
        approaches are limited to one every {MIN_DAYS_BETWEEN_OUTREACH} days,
        and agreement lapses on the organization&apos;s retention schedule
        rather than never.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-4">
        {(["OPTED_IN", "INVITED", "NOT_ASKED", "OPTED_OUT"] as const).map((s) => (
          <Card key={s} className="p-4">
            <Badge tone={CONSENT_TONE[s]}>{CONSENT_LABEL[s]}</Badge>
            <p className="mt-2 text-2xl font-bold text-navy-900">
              {byStatus.get(s) ?? 0}
            </p>
          </Card>
        ))}
      </div>

      {suppressed > 0 && (
        <p className="mt-3 text-sm text-navy-500">
          {suppressed} address{suppressed === 1 ? " is" : "es are"} on the
          permanent do-not-contact list. That list is stored as hashes and
          outlives the deletion of a candidate record, so purging someone&apos;s
          data cannot erase the fact that they asked not to be contacted.
        </p>
      )}

      <TalentSearch
        pools={pools.map((p) => ({ id: p.id, name: p.name }))}
        tags={tags.map((t) => ({ id: t.id, label: t.label, count: t._count.profiles }))}
        openRequisitions={openRequisitions}
      />

      <h3 className="mt-10 text-sm font-bold uppercase tracking-wide text-navy-500">
        Pools
      </h3>
      <Card className="mt-3 overflow-x-auto">
        {pools.length === 0 ? (
          <p className="p-4 text-sm text-navy-500">
            No pools yet. A pool is a named group worth going back to — &ldquo;2026
            sales finalists&rdquo;, &ldquo;night-shift capable&rdquo;.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
              <tr>
                <th className="px-4 py-3">Pool</th>
                <th className="px-4 py-3">Role type</th>
                <th className="px-4 py-3">People</th>
              </tr>
            </thead>
            <tbody>
              {pools.map((p) => (
                <tr key={p.id} className="border-b border-navy-50 last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-semibold text-navy-900">{p.name}</span>
                    {p.description && (
                      <span className="block text-xs text-navy-500">
                        {p.description}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-navy-600">
                    {p.jobProfile?.name ?? "Any"}
                  </td>
                  <td className="px-4 py-3 text-navy-600">{p._count.members}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="mt-5">
        <NewPoolForm jobProfiles={jobProfiles} />
      </div>

      {openRequisitions.length > 0 && (
        <p className="mt-8 text-sm text-navy-500">
          Looking for people for a specific opening? Use{" "}
          <Link
            href="/admin/recruiting"
            className="font-semibold text-fsw-700 hover:underline"
          >
            Recruiting
          </Link>{" "}
          — every open requisition has a &ldquo;past applicants worth another
          look&rdquo; panel, or search here directly.
        </p>
      )}
    </div>
  );
}
