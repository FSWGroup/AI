"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { Card } from "@/components/ui";

interface Match {
  profileId: string;
  candidateId: string;
  name: string;
  reasons: { kind: string; text: string }[];
}

/**
 * Past applicants worth another look for this opening.
 *
 * Reasons, never a score. Ordering is by how far a real process took someone,
 * which is a fact about what people already decided rather than a prediction
 * this panel is making.
 */
export function PastApplicantsPanel({ requisitionId }: { requisitionId: string }) {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ matches: Match[] }>(
      `/api/admin/talent/matches?requisitionId=${requisitionId}`,
    )
      .then((out) => {
        if (!cancelled) setMatches(out.matches);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load past applicants.");
      });
    return () => {
      cancelled = true;
    };
  }, [requisitionId]);

  if (error) return null;
  if (matches !== null && matches.length === 0) return null;

  return (
    <Card className="p-6">
      <h3 className="text-sm font-bold text-navy-900">
        Past applicants worth another look
      </h3>
      <p className="mt-1 text-sm text-navy-500">
        People who agreed to be kept in mind and have history that lines up with
        this role. Reasons, not a fit score.
      </p>
      {matches === null ? (
        <p className="mt-3 text-sm text-navy-400">Looking…</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {matches.slice(0, 8).map((m) => (
            <li key={m.profileId}>
              <Link
                href={`/admin/candidates/${m.candidateId}`}
                className="font-semibold text-fsw-700 hover:underline"
              >
                {m.name}
              </Link>
              <ul className="mt-1 space-y-0.5 text-sm text-navy-600">
                {m.reasons.map((r, i) => (
                  <li key={i}>· {r.text}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {matches !== null && matches.length > 8 && (
        <p className="mt-3 text-sm text-navy-500">
          and {matches.length - 8} more —{" "}
          <Link href="/admin/talent" className="font-semibold text-fsw-700 hover:underline">
            see them all
          </Link>
          .
        </p>
      )}
    </Card>
  );
}
