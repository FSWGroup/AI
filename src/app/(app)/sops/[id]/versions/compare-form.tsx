"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

interface VersionOption {
  id: string;
  versionNumber: string;
  publishedAt: Date;
}

export function CompareForm({ versions, defaultA, defaultB }: { versions: VersionOption[]; defaultA?: string; defaultB?: string }) {
  const router = useRouter();
  const oldestFirst = [...versions].reverse();
  const [a, setA] = useState(defaultA ?? oldestFirst[0]?.id ?? "");
  const [b, setB] = useState(defaultB ?? versions[0]?.id ?? "");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!a || !b) return;
    router.push(`?compare=${a},${b}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="versionA" className="text-[0.8125rem] font-medium text-[var(--text-primary)]">
          From
        </label>
        <Select id="versionA" value={a} onChange={(e) => setA(e.target.value)}>
          {oldestFirst.map((v) => (
            <option key={v.id} value={v.id}>
              {`v${v.versionNumber} — ${new Date(v.publishedAt).toLocaleDateString()}`}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="versionB" className="text-[0.8125rem] font-medium text-[var(--text-primary)]">
          To
        </label>
        <Select id="versionB" value={b} onChange={(e) => setB(e.target.value)}>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {`v${v.versionNumber} — ${new Date(v.publishedAt).toLocaleDateString()}`}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" disabled={!a || !b || a === b}>
        Compare
      </Button>
    </form>
  );
}
