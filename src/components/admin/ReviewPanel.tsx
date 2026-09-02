"use client";

/**
 * The team review panel on an application.
 *
 * Two audiences in one component. A reviewer sees their own review and is told
 * plainly why the others are withheld. Someone with oversight sees every filed
 * review side by side — ratings, written feedback, and where the panel
 * disagrees.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { RECOMMENDATION_LABEL, RATING_LABEL } from "@/lib/ats/scorecards";

export interface PanelReview {
  id: string;
  reviewerId: string;
  reviewerName: string;
  status: string;
  recommendation: keyof typeof RECOMMENDATION_LABEL | null;
  summary: string | null;
  ratings: { criterionName: string; rating: number | null; note: string | null }[];
}

export interface PanelRound {
  id: string;
  name: string;
  blind: boolean;
  status: string;
  dueAt: string | null;
  reviews: PanelReview[];
  /** Reviews this viewer may read, already filtered server-side. */
  visible: PanelReview[];
  hiddenCount: number;
  hiddenReason: string | null;
  progress: { invited: number; submitted: number; outstanding: string[] };
  consensus: {
    submittedCount: number;
    averageScore: number | null;
    split: boolean;
    spread: number | null;
    criteria: {
      criterionName: string;
      average: number | null;
      split: boolean;
      ratings: { reviewerName: string; rating: number | null; note: string | null }[];
    }[];
  };
  /** The viewer's own review in this round, if they were asked. */
  myReviewId: string | null;
  myReviewStatus: string | null;
}

function toneFor(rec: string | null): "green" | "blue" | "amber" | "neutral" {
  if (rec === "STRONG_YES") return "green";
  if (rec === "YES") return "blue";
  if (rec === "NO" || rec === "STRONG_NO") return "amber";
  return "neutral";
}

export function ReviewPanel({
  applicationId,
  rounds,
  canOpenRound,
  canSeeAll,
  teamOptions,
  kitOptions,
}: {
  applicationId: string;
  rounds: PanelRound[];
  canOpenRound: boolean;
  canSeeAll: boolean;
  teamOptions: { id: string; name: string; role: string }[];
  kitOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("Team review");
  const [kitId, setKitId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  async function openRound(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/applications/${applicationId}/reviews`, {
        body: { name, reviewerIds: selected, kitId: kitId || null, blind: true },
      });
      setOpening(false);
      setSelected([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open the round.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-navy-900">Team review</h2>
        {canOpenRound && !opening && (
          <Button variant="ghost" onClick={() => setOpening(true)}>
            Ask the team to review
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {error}
        </p>
      )}

      {opening && (
        <div className="mt-4 rounded-xl border border-navy-100 p-4">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-navy-500">
            Round name
          </label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <label className="mb-1.5 mt-3 block text-xs font-semibold uppercase tracking-wide text-navy-500">
            Criteria (optional)
          </label>
          <Select value={kitId} onChange={(e) => setKitId(e.target.value)}>
            <option value="">Overall recommendation only</option>
            {kitOptions.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </Select>
          <p className="mb-1.5 mt-3 text-xs font-semibold uppercase tracking-wide text-navy-500">
            Who should review
          </p>
          <div className="space-y-1.5">
            {teamOptions.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-fsw-600"
                  checked={selected.includes(t.id)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked
                        ? [...prev, t.id]
                        : prev.filter((id) => id !== t.id),
                    )
                  }
                />
                {t.name}
                <span className="text-xs text-navy-400">
                  {t.role.replace(/_/g, " ").toLowerCase()}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-navy-500">
            Reviews are blind: nobody sees anyone else&rsquo;s until they file
            their own. Reading the first opinion before forming yours turns four
            reviewers into one opinion with four names on it.
          </p>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy || selected.length === 0} onClick={() => void openRound()}>
              Open the round
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setOpening(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {rounds.length === 0 && !opening && (
        <p className="mt-3 text-sm text-navy-400">
          No review rounds yet.
        </p>
      )}

      <div className="mt-4 space-y-6">
        {rounds.map((round) => (
          <section key={round.id} className="rounded-xl border border-navy-100 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-navy-900">{round.name}</p>
                <p className="text-xs text-navy-500">
                  {round.progress.submitted} of {round.progress.invited} filed
                  {round.progress.outstanding.length > 0 &&
                    ` · waiting on ${round.progress.outstanding.join(", ")}`}
                  {round.blind ? " · blind" : ""}
                </p>
              </div>
              {round.myReviewId && round.myReviewStatus !== "SUBMITTED" && (
                <Link
                  href={`/admin/recruiting/reviews/${round.myReviewId}`}
                  className="rounded-lg bg-fsw-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fsw-700"
                >
                  Write your review
                </Link>
              )}
            </div>

            {round.hiddenCount > 0 && round.hiddenReason && (
              <p className="mt-3 rounded-lg bg-navy-50 p-3 text-xs leading-relaxed text-navy-700">
                {round.hiddenReason}
              </p>
            )}

            {canSeeAll && round.hiddenCount === 0 && round.consensus.submittedCount > 1 && (
              <div className="mt-3 rounded-lg bg-navy-50 p-3">
                <p className="text-xs text-navy-700">
                  <strong className="text-navy-900">
                    {round.consensus.submittedCount} reviews
                  </strong>
                  {round.consensus.averageScore != null && (
                    <> · average {round.consensus.averageScore.toFixed(1)} of 4</>
                  )}
                  {round.consensus.split && (
                    <span className="ml-2 font-semibold text-amber-800">
                      the panel is split
                    </span>
                  )}
                </p>
                {round.consensus.split && (
                  <p className="mt-1 text-xs leading-relaxed text-navy-600">
                    Read the individual write-ups rather than the average. A
                    mean describes a unanimously lukewarm panel and a violently
                    divided one identically, and those call for opposite next
                    steps.
                  </p>
                )}
              </div>
            )}

            {round.visible.length > 0 && (
              <div className="mt-4 space-y-3">
                {round.visible.map((r) => (
                  <div key={r.id} className="rounded-lg border border-navy-100 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-navy-900">
                        {r.reviewerName}
                      </p>
                      {r.recommendation && (
                        <Badge tone={toneFor(r.recommendation)}>
                          {RECOMMENDATION_LABEL[r.recommendation]}
                        </Badge>
                      )}
                    </div>
                    {r.summary && (
                      <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-navy-700">
                        {r.summary}
                      </p>
                    )}
                    {r.ratings.filter((x) => x.rating != null || x.note).length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs">
                        {r.ratings.map((x) => (
                          <li key={x.criterionName} className="flex justify-between gap-3">
                            <span className="text-navy-700">{x.criterionName}</span>
                            <span className="text-right text-navy-500">
                              {x.rating == null
                                ? "not assessed"
                                : `${x.rating}/4 — ${RATING_LABEL[x.rating]}`}
                              {x.note && (
                                <span className="mt-0.5 block italic">{x.note}</span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            {canSeeAll && round.hiddenCount === 0 && round.consensus.criteria.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-navy-500">
                  By criterion
                </p>
                <table className="mt-1.5 w-full text-left text-xs">
                  <tbody className="divide-y divide-navy-50">
                    {round.consensus.criteria.map((c) => (
                      <tr key={c.criterionName}>
                        <td className="py-1.5 text-navy-700">{c.criterionName}</td>
                        <td className="py-1.5 text-right text-navy-500">
                          {c.ratings
                            .map((r) => `${r.reviewerName.split(" ")[0]} ${r.rating ?? "—"}`)
                            .join(" · ")}
                        </td>
                        <td className="w-20 py-1.5 text-right font-semibold text-navy-800">
                          {c.average == null ? "—" : c.average.toFixed(1)}
                          {c.split && (
                            <span className="ml-1 text-amber-700" title="Reviewers disagreed">
                              ⚠
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>
    </Card>
  );
}
