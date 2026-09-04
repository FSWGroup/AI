import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, SectionHeading } from "@/components/ui";
import {
  calibrateRater,
  calibrateTeam,
  HEADLINE_LABEL,
  HEADLINE_TONE,
  MIN_ASSESSMENTS,
  type CalibrationObservation,
  type RaterCalibration,
} from "@/lib/calibration/calibration";
import { loadCalibrationData } from "@/lib/calibration/service";

export const dynamic = "force-dynamic";

export default async function CalibrationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  const canSeeEveryone = can(user.role, "VIEW_INTERVIEWER_CALIBRATION");
  const canRate = can(user.role, "SUBMIT_SCORECARD");
  if (!canSeeEveryone && !canRate) redirect("/admin");

  // Loaded once and shared. Both cards are computed from the same two sets,
  // and calling the two service functions ran each load twice.
  const { assessments, outcomes } = await loadCalibrationData();
  const own = canRate ? calibrateRater(user.id, user.name, assessments, outcomes) : null;
  const team = canSeeEveryone ? calibrateTeam(assessments, outcomes) : null;

  return (
    <div className="mx-auto max-w-4xl">
      <SectionHeading
        eyebrow="Interviewing"
        title="Calibration"
        description="Two interviewers watching the same interview reach different conclusions, and the difference is often about the interviewer rather than the candidate. This measures that so it can be corrected."
      />

      <p className="mt-4 rounded-lg bg-navy-50 p-4 text-sm text-navy-700">
        <span className="font-semibold text-navy-900">
          Everything here is a paired comparison.
        </span>{" "}
        Nobody is measured against the team&apos;s overall average — only
        against the other people who assessed the <em>same</em> candidates.
        An interviewer who only meets finalists would look generous beside one
        who takes every first screen, and that difference is the pipeline, not
        their judgement.
      </p>

      {/* ---- Your own card ---- */}
      {canRate && (
        <>
          <h3 className="mt-8 text-sm font-bold uppercase tracking-wide text-navy-500">
            Your card
          </h3>
          <p className="mt-1 text-sm text-navy-500">
            Only you and the people who hold the oversight permission can see
            this. It is here to be useful to you, not to rank you against
            anyone.
          </p>
          {own ? (
            <RaterCard calibration={own} className="mt-3" showName={false} />
          ) : (
            <Card className="mt-3 p-5">
              <p className="text-sm text-navy-600">
                You have not filed a submitted scorecard or review yet. Your
                card appears once you have.
              </p>
            </Card>
          )}
        </>
      )}

      {/* ---- The team ---- */}
      {team && (
        <>
          <h3 className="mt-10 text-sm font-bold uppercase tracking-wide text-navy-500">
            Across the interviewing team
          </h3>

          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
                Assessments
              </p>
              <p className="mt-1 text-2xl font-bold text-navy-900">
                {team.totalAssessments}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
                Typical gap between two raters
              </p>
              <p className="mt-1 text-2xl font-bold text-navy-900">
                {team.panelDisagreement !== null
                  ? team.panelDisagreement.toFixed(2)
                  : "—"}
              </p>
              <p className="mt-0.5 text-xs text-navy-500">
                On a four-point scale. Above about 0.8 the panel is not
                measuring the same thing.
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
                Candidates seen by 2+ people
              </p>
              <p className="mt-1 text-2xl font-bold text-navy-900">
                {team.sharedSubjects}
              </p>
              <p className="mt-0.5 text-xs text-navy-500">
                {team.soloSubjects} were seen by one person only.
              </p>
            </Card>
          </div>

          {team.warnings.map((w, i) => (
            <p key={i} className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {w}
            </p>
          ))}

          <p className="mt-5 text-sm text-navy-500">
            Listed alphabetically. There is deliberately no ranking and no
            overall interviewer score — the moment there is one, people start
            rating to the metric instead of to the candidate.
          </p>

          <div className="mt-3 space-y-4">
            {team.raters.length === 0 && (
              <Card className="p-5">
                <p className="text-sm text-navy-600">
                  No submitted scorecards or reviews yet.
                </p>
              </Card>
            )}
            {team.raters.map((r) => (
              <RaterCard key={r.raterId} calibration={r} showName />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RaterCard({
  calibration: c,
  showName,
  className,
}: {
  calibration: RaterCalibration;
  showName: boolean;
  className?: string;
}) {
  const thin = c.assessments < MIN_ASSESSMENTS;
  return (
    <Card className={`p-5 ${className ?? ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          {showName && (
            <p className="font-semibold text-navy-900">{c.raterName}</p>
          )}
          <p className="text-sm text-navy-500">
            {c.assessments} assessment{c.assessments === 1 ? "" : "s"}
            {c.sharedSubjects > 0 &&
              `, ${c.sharedSubjects} alongside someone else`}
          </p>
        </div>
        {!thin && (
          <Badge tone={HEADLINE_TONE[c.headline]} className="whitespace-nowrap">
            {HEADLINE_LABEL[c.headline]}
          </Badge>
        )}
      </div>

      {!thin && (
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <Metric
            label="Gap from the panel"
            value={
              c.leniency !== null
                ? `${c.leniency > 0 ? "+" : ""}${c.leniency.toFixed(2)}`
                : "—"
            }
            hint="On the same candidates"
          />
          <Metric
            label="Agreement"
            value={c.agreement !== null ? c.agreement.toFixed(2) : "—"}
            hint="Tracks the panel"
          />
          <Metric
            label="Spread"
            value={c.ownSpread.toFixed(2)}
            hint="Uses the scale"
          />
          <Metric
            label="Predicts performance"
            value={c.predictiveR !== null ? c.predictiveR.toFixed(2) : "—"}
            hint={
              c.predictiveR !== null
                ? `${c.outcomeCount} hired and rated`
                : "Not enough hires rated yet"
            }
          />
        </div>
      )}

      {!thin && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
            How they use the scale
          </p>
          <div className="mt-2 flex gap-1">
            {([1, 2, 3, 4] as const).map((band) => {
              const count = c.distribution[band];
              // Scaled to the tallest bucket, not to the whole sample: the
              // shape of the distribution is the point, and against a 100%
              // ceiling every bar is short and they all look alike.
              const tallest = Math.max(...([1, 2, 3, 4] as const).map((b) => c.distribution[b]), 1);
              const pct = (count / tallest) * 100;
              return (
                <div key={band} className="flex-1">
                  <div className="flex h-14 items-end rounded bg-navy-50">
                    <div
                      className="w-full rounded bg-fsw-500"
                      style={{ height: `${count === 0 ? 2 : Math.max(4, Math.round(pct * 0.52))}px` }}
                    />
                  </div>
                  <p className="mt-1 text-center text-xs text-navy-500">
                    {["Strong no", "No", "Yes", "Strong yes"][band - 1]}
                  </p>
                  <p className="text-center text-xs font-semibold text-navy-700">
                    {count}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3 border-t border-navy-100 pt-4">
        {c.observations.map((o, i) => (
          <Observation key={i} observation={o} />
        ))}
      </div>
    </Card>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-navy-400">{label}</p>
      <p className="font-mono text-lg font-bold text-navy-900">{value}</p>
      <p className="text-xs text-navy-500">{hint}</p>
    </div>
  );
}

function Observation({ observation }: { observation: CalibrationObservation }) {
  const positive =
    observation.kind === "WELL_CALIBRATED" || observation.kind === "PREDICTIVE";
  return (
    <div>
      <p
        className={
          positive
            ? "text-sm font-medium text-emerald-800"
            : "text-sm font-medium text-navy-900"
        }
      >
        {observation.finding}
      </p>
      {observation.suggestion && (
        <p className="mt-1 text-sm text-navy-600">{observation.suggestion}</p>
      )}
    </div>
  );
}
