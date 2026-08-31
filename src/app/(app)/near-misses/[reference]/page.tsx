import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireActor } from "@/lib/auth/guard";
import {
  getPublishedNearMiss,
  getPublishedNearMisses,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
} from "@/lib/services/near-miss";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEVERITY_TONE } from "@/app/(app)/near-misses/severity";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reference: string }>;
}): Promise<Metadata> {
  const { reference } = await params;
  return { title: `Near Miss ${reference.toUpperCase()}` };
}

/** One narrative section, rendered only when it has content. */
function Section({ label, body }: { label: string; body: string | null }) {
  if (!body || body.trim().length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-[0.6875rem] font-medium tracking-[0.06em] text-[var(--text-muted)] uppercase">
        {label}
      </h2>
      {body.split(/\n{2,}/).map((paragraph, index) => (
        <p
          key={index}
          className="text-[0.9375rem] leading-relaxed whitespace-pre-line text-[var(--text-secondary)]"
        >
          {paragraph}
        </p>
      ))}
    </section>
  );
}

export default async function NearMissDetailPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const actor = await requireActor();
  if (!actor.permissions.has("nearmiss.view")) {
    if (actor.permissions.has("nearmiss.report")) redirect("/near-misses/report");
    redirect("/home");
  }

  const { reference } = await params;
  const nearMiss = await getPublishedNearMiss(actor, reference);
  if (!nearMiss) notFound();

  // Others of the same kind: the pattern is more instructive than the instance.
  const related = (
    await getPublishedNearMisses(actor, { category: nearMiss.category, limit: 5 })
  ).filter((item) => item.id !== nearMiss.id);

  return (
    <>
      <PageHeader
        title={nearMiss.title}
        crumbs={[
          { label: "Home", href: "/home" },
          { label: "Near Misses", href: "/near-misses" },
          { label: nearMiss.reference },
        ]}
        meta={
          <>
            <Badge tone="navy">{nearMiss.reference}</Badge>
            <Badge tone={SEVERITY_TONE[nearMiss.severity]}>
              {SEVERITY_LABELS[nearMiss.severity]}
            </Badge>
            <Badge tone="neutral">{CATEGORY_LABELS[nearMiss.category]}</Badge>
            {nearMiss.department?.name && <Badge tone="neutral">{nearMiss.department.name}</Badge>}
          </>
        }
        actions={
          <Link href="/near-misses/report">
            <Button variant="outline">Report a near miss</Button>
          </Link>
        }
      />

      <PageBody className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <Card>
            <CardContent className="flex flex-col gap-5">
              <Section label="What happened" body={nearMiss.whatHappened} />
              <Section label="How it was caught" body={nearMiss.howItWasCaught} />
              <Section label="Why it happened" body={nearMiss.whyItHappened} />
              <Section label="What changed" body={nearMiss.whatChanged} />
            </CardContent>
          </Card>

          {/*
            Said plainly on every case study rather than in a policy document
            nobody opens. It is the whole basis on which people file these.
          */}
          <p className="text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
            Nobody is named in this record, and no fault is stored against anyone. Reports are
            reviewed before publication and anything identifying a person is removed. If a
            regulatory requirement is involved, verify it with a qualified legal/safety advisor —
            this library is how the work actually failed, not a statement of the law.
          </p>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-80">
          {(nearMiss.preventingSop || nearMiss.teachingCourse) && (
            <Card>
              <CardHeader>
                <CardTitle as="h2">What covers this now</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {nearMiss.preventingSop && (
                  <div>
                    <p className="text-[0.6875rem] font-medium tracking-[0.06em] text-[var(--text-muted)] uppercase">
                      Procedure
                    </p>
                    <Link
                      href={`/sops/${nearMiss.preventingSop.id}`}
                      className="mt-1 block rounded-sm text-[0.875rem] font-medium text-[var(--text-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    >
                      {nearMiss.preventingSop.sopCode} — {nearMiss.preventingSop.title}
                    </Link>
                  </div>
                )}
                {nearMiss.teachingCourse && (
                  <div>
                    <p className="text-[0.6875rem] font-medium tracking-[0.06em] text-[var(--text-muted)] uppercase">
                      Training
                    </p>
                    <Link
                      href={`/courses/${nearMiss.teachingCourse.id}`}
                      className="mt-1 block rounded-sm text-[0.875rem] font-medium text-[var(--text-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    >
                      {nearMiss.teachingCourse.title}
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {!nearMiss.preventingSop && (
            <Card>
              <CardContent className="flex flex-col gap-2">
                <p className="text-[0.875rem] font-semibold text-[var(--text-primary)]">
                  No procedure covers this yet
                </p>
                <p className="text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                  That is the honest answer, and it is itself the finding. Nothing written down
                  would have caught this one.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle as="h2">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-2.5 text-[0.8125rem]">
                <div>
                  <dt className="text-[var(--text-muted)]">When it happened</dt>
                  <dd className="text-[var(--text-primary)]">
                    {nearMiss.occurredOn ? nearMiss.occurredOn.toLocaleDateString() : "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Published</dt>
                  <dd className="text-[var(--text-primary)]">
                    {nearMiss.publishedAt ? nearMiss.publishedAt.toLocaleDateString() : "—"}
                  </dd>
                </div>
                {nearMiss.location?.name && (
                  <div>
                    <dt className="text-[var(--text-muted)]">Location</dt>
                    <dd className="text-[var(--text-primary)]">{nearMiss.location.name}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-[var(--text-muted)]">Reported by</dt>
                  <dd className="text-[var(--text-primary)]">
                    Not recorded in the published case study
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {related.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Others of the same kind</CardTitle>
              </CardHeader>
              <CardContent>
                <ul aria-label="Related case studies" className="flex flex-col gap-2">
                  {related.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/near-misses/${item.reference}`}
                        className="rounded-sm text-[0.8125rem] text-[var(--text-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                      >
                        {item.reference} — {item.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </aside>
      </PageBody>
    </>
  );
}
