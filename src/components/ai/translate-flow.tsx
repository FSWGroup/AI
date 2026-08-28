"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { searchSopsAction, searchCoursesAction, translateContentAction, type ContentOption } from "@/app/(app)/admin/ai-studio/actions";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Glyph } from "@/components/icons";

const LANGUAGE_LABELS: Record<string, string> = {
  es: "Spanish", fil: "Filipino (Tagalog)", tl: "Filipino (Tagalog)", vi: "Vietnamese",
  zh: "Mandarin Chinese", fr: "French", pt: "Portuguese",
};

export function TranslateFlow({ available, languages }: { available: boolean; languages: string[] }) {
  const [entityType, setEntityType] = React.useState<"SOP" | "COURSE">("SOP");
  const [query, setQuery] = React.useState("");
  const [options, setOptions] = React.useState<ContentOption[]>([]);
  const [selected, setSelected] = React.useState<ContentOption | null>(null);
  const targetOptions = React.useMemo(() => {
    const codes = new Set([...languages.filter((l) => l !== "en"), ...Object.keys(LANGUAGE_LABELS)]);
    return [...codes];
  }, [languages]);
  const [targetLanguage, setTargetLanguage] = React.useState(targetOptions[0] ?? "es");
  const [translating, setTranslating] = React.useState(false);
  const [result, setResult] = React.useState<{ id: string; language: string } | null>(null);

  React.useEffect(() => {
    setSelected(null);
    setOptions([]);
    setQuery("");
  }, [entityType]);

  React.useEffect(() => {
    const handle = setTimeout(async () => {
      const action = entityType === "SOP" ? searchSopsAction : searchCoursesAction;
      const res = await action(query);
      if (res.ok) setOptions(res.data);
    }, 250);
    return () => clearTimeout(handle);
  }, [query, entityType]);

  async function handleTranslate() {
    if (!selected) {
      toast.error("Pick a published SOP or course first.");
      return;
    }
    setTranslating(true);
    try {
      const res = await translateContentAction({ entityType, entityId: selected.id, targetLanguage });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setResult(res.data);
      toast.success("Draft translation created.");
    } finally {
      setTranslating(false);
    }
  }

  if (result && selected) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-success-50 text-success-700">
            <Glyph name="check" className="h-5 w-5" />
          </div>
          <p className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">
            Draft translation created ({LANGUAGE_LABELS[result.language] ?? result.language})
          </p>
          <p className="max-w-sm text-[0.8125rem] text-[var(--text-muted)]">
            It&apos;s saved as a draft translation of &ldquo;{selected.title}&rdquo;, awaiting human review before it can be
            published alongside the original.
          </p>
          <div className="mt-2 flex gap-2">
            <Link
              href={entityType === "SOP" ? `/sops/${selected.id}` : `/courses/${selected.id}`}
              className="inline-flex h-9.5 items-center justify-center rounded-md bg-[var(--brand-primary)] px-4 text-sm font-medium text-white hover:bg-[var(--brand-primary-hover)]"
            >
              View source content
            </Link>
            <Button variant="outline" onClick={() => { setResult(null); setSelected(null); setQuery(""); }}>
              Translate another
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pick content to translate</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!available && (
          <p className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-800">
            AI text generation isn&apos;t configured — translation will fail until an administrator sets an API key.
          </p>
        )}
        <Field label="Content type" htmlFor="entity-type">
          <Select id="entity-type" value={entityType} onChange={(e) => setEntityType(e.target.value as "SOP" | "COURSE")}>
            <option value="SOP">SOP</option>
            <option value="COURSE">Course</option>
          </Select>
        </Field>
        <Field label={`Search published ${entityType === "SOP" ? "SOPs" : "courses"}`} htmlFor="entity-search">
          <Input id="entity-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Start typing a title…" />
          {options.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 rounded-md border border-[var(--border-subtle)] p-1">
              {options.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(o);
                      setQuery(o.title);
                      setOptions([]);
                    }}
                    className="w-full rounded px-2 py-1.5 text-left text-[0.8125rem] hover:bg-[var(--surface-sunken)]"
                  >
                    {o.title} {o.subtitle && <span className="text-[var(--text-muted)]">· {o.subtitle}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selected && <p className="mt-1 text-[0.75rem] text-success-700">Selected: {selected.title}</p>}
        </Field>
        <Field label="Target language" htmlFor="target-language">
          <Select id="target-language" value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)}>
            {targetOptions.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_LABELS[code] ?? code}
              </option>
            ))}
          </Select>
        </Field>
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={handleTranslate} loading={translating} disabled={!selected}>
          <Glyph name="sparkle" className="h-4 w-4" />
          Create draft translation
        </Button>
      </CardFooter>
    </Card>
  );
}
