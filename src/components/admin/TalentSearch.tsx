"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, Card, ErrorText, Input, Select } from "@/components/ui";
import {
  CONSENT_LABEL,
  CONSENT_TONE,
  type ConsentStatus,
} from "@/lib/talent/consent";

interface Profile {
  id: string;
  consentStatus: ConsentStatus;
  contactCount: number;
  lastContactedAt: string | null;
  expiresAt: string | null;
  summary: string | null;
  interests: string | null;
  candidate: { id: string; firstName: string; lastName: string; email: string };
  tags: { tag: { id: string; label: string } }[];
  memberships: { pool: { id: string; name: string } }[];
}

interface MatchReason {
  kind: string;
  text: string;
}
interface Match {
  profileId: string;
  candidateId: string;
  name: string;
  reasons: MatchReason[];
  matchedTags: string[];
}

export function TalentSearch({
  pools,
  tags,
  openRequisitions,
}: {
  pools: { id: string; name: string }[];
  tags: { id: string; label: string; count: number }[];
  openRequisitions: { id: string; title: string }[];
}) {
  const [mode, setMode] = useState<"search" | "match">("search");
  const [query, setQuery] = useState("");
  const [poolId, setPoolId] = useState("");
  const [tagId, setTagId] = useState("");
  const [status, setStatus] = useState("");
  const [requisitionId, setRequisitionId] = useState(openRequisitions[0]?.id ?? "");
  const [matchTags, setMatchTags] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  const search = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ profiles: Profile[] }>("/api/admin/talent/profiles", {
        method: "POST",
        body: {
          query: query || null,
          tagIds: tagId ? [tagId] : [],
          poolId: poolId || null,
          consentStatus: status || null,
        },
      });
      setProfiles(out.profiles);
      setRan(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }, [query, tagId, poolId, status]);

  useEffect(() => {
    if (mode === "search") void search();
    // Run once on mount so the page is not empty; filters re-run on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runMatch = async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ requisitionId });
      if (matchTags.trim()) params.set("tags", matchTags);
      const out = await api<{ matches: Match[] }>(
        `/api/admin/talent/matches?${params.toString()}`,
      );
      setMatches(out.matches);
      setRan(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not find matches.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-8">
      <div className="flex gap-2">
        {(["search", "match"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={
              mode === m
                ? "rounded-lg bg-navy-800 px-4 py-2 text-sm font-semibold text-white"
                : "rounded-lg border border-navy-200 px-4 py-2 text-sm font-semibold text-navy-700 hover:bg-navy-50"
            }
          >
            {m === "search" ? "Search everyone" : "Match to an opening"}
          </button>
        ))}
      </div>

      {mode === "search" ? (
        <Card className="mt-3 p-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <Input
              placeholder="Name or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
            />
            <Select value={poolId} onChange={(e) => setPoolId(e.target.value)}>
              <option value="">Any pool</option>
              {pools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select value={tagId} onChange={(e) => setTagId(e.target.value)}>
              <option value="">Any tag</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({t.count})
                </option>
              ))}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Anyone we may contact or ask</option>
              <option value="OPTED_IN">Agreed to be kept in mind</option>
              <option value="INVITED">Asked, no answer yet</option>
              <option value="NOT_ASKED">Not asked</option>
            </Select>
          </div>
          <Button className="mt-3" variant="secondary" disabled={busy} onClick={search}>
            {busy ? "Searching…" : "Search"}
          </Button>
          <p className="mt-2 text-xs text-navy-500">
            People who asked not to be contacted never appear in these results.
          </p>
        </Card>
      ) : (
        <Card className="mt-3 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              value={requisitionId}
              onChange={(e) => setRequisitionId(e.target.value)}
            >
              {openRequisitions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </Select>
            <Input
              placeholder="Extra tags to look for, comma separated"
              value={matchTags}
              onChange={(e) => setMatchTags(e.target.value)}
            />
          </div>
          <Button
            className="mt-3"
            variant="secondary"
            disabled={busy || !requisitionId}
            onClick={runMatch}
          >
            {busy ? "Looking…" : "Find past applicants"}
          </Button>
          <p className="mt-2 text-xs text-navy-500">
            Results carry reasons, not a fit score. Ordering is by how far a real
            process took someone — a fact about what people already decided,
            not a prediction.
          </p>
        </Card>
      )}

      {error && <ErrorText className="mt-3">{error}</ErrorText>}

      {mode === "match" ? (
        <div className="mt-4 space-y-3">
          {ran && matches.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-navy-600">
                Nobody in the pool matches this opening yet. That is the normal
                state early on — the pool fills up as people are asked and say
                yes.
              </p>
            </Card>
          )}
          {matches.map((m) => (
            <Card key={m.profileId} className="p-5">
              <Link
                href={`/admin/candidates/${m.candidateId}`}
                className="font-semibold text-fsw-700 hover:underline"
              >
                {m.name}
              </Link>
              <ul className="mt-2 space-y-1 text-sm text-navy-600">
                {m.reasons.map((r, i) => (
                  <li key={i}>· {r.text}</li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="mt-4 overflow-x-auto">
          {profiles.length === 0 ? (
            <p className="p-4 text-sm text-navy-500">
              {ran
                ? "Nobody matches. Profiles appear once candidates have been asked whether they want to be kept in mind."
                : "Searching…"}
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
                <tr>
                  <th className="px-4 py-3">Person</th>
                  <th className="px-4 py-3">Tags</th>
                  <th className="px-4 py-3">Pools</th>
                  <th className="px-4 py-3">Approaches</th>
                  <th className="px-4 py-3">Consent</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className="border-b border-navy-50 last:border-0 align-top">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/candidates/${p.candidate.id}`}
                        className="font-semibold text-fsw-700 hover:underline"
                      >
                        {p.candidate.firstName} {p.candidate.lastName}
                      </Link>
                      {p.interests && (
                        <span className="mt-0.5 block text-xs text-navy-500">
                          &ldquo;{p.interests.slice(0, 120)}
                          {p.interests.length > 120 ? "…" : ""}&rdquo;
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {p.tags.map((t) => (
                          <Badge key={t.tag.id} tone="blue">
                            {t.tag.label}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-navy-600">
                      {p.memberships.map((m) => m.pool.name).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-navy-600">
                      {p.contactCount}
                      {p.lastContactedAt && (
                        <span className="block text-xs text-navy-400">
                          last {p.lastContactedAt.slice(0, 10)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={CONSENT_TONE[p.consentStatus]}>
                        {CONSENT_LABEL[p.consentStatus]}
                      </Badge>
                      {p.expiresAt && (
                        <span className="mt-1 block text-xs text-navy-400">
                          lapses {p.expiresAt.slice(0, 10)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
