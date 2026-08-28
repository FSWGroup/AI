"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  generateSopDraftAction,
  saveSopDraftAction,
  findSimilarContentAction,
  type SaveSopDraftInput,
} from "@/app/(app)/admin/ai-studio/actions";
import type { SopDraftOutput, SopSourceKind } from "@/lib/ai/generate";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, Glyph } from "@/components/icons";
import { BlockEditor } from "@/components/ai/block-editor";
import { AiGeneratedBadge } from "@/components/ai/ai-badge";
import type { Block } from "@/lib/content/types";

const SOURCE_KINDS: { value: SopSourceKind; label: string; placeholder: string }[] = [
  { value: "prompt", label: "A short prompt", placeholder: "Describe the procedure you want documented…" },
  { value: "notes", label: "Rough notes", placeholder: "Paste your rough notes or bullet points…" },
  { value: "transcript", label: "A call or interview transcript", placeholder: "Paste the transcript…" },
  { value: "document", label: "A pasted document", placeholder: "Paste the extracted text of the document…" },
];

type Step = "source" | "review";

function parseLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

function parseDefinitions(text: string): { term: string; definition: string }[] {
  return parseLines(text)
    .map((line) => {
      const [term, ...rest] = line.split(":");
      return { term: (term ?? "").trim(), definition: rest.join(":").trim() };
    })
    .filter((d) => d.term);
}

function definitionsToText(defs: { term: string; definition: string }[]): string {
  return defs.map((d) => `${d.term}: ${d.definition}`).join("\n");
}

function parseTroubleshooting(text: string): { problem: string; resolution: string }[] {
  return parseLines(text)
    .map((line) => {
      const [problem, ...rest] = line.split("|");
      return { problem: (problem ?? "").trim(), resolution: rest.join("|").trim() };
    })
    .filter((t) => t.problem);
}

function troubleshootingToText(items: { problem: string; resolution: string }[]): string {
  return items.map((t) => `${t.problem} | ${t.resolution}`).join("\n");
}

export function SopDraftFlow({ available }: { available: boolean }) {
  const [step, setStep] = React.useState<Step>("source");
  const [sourceKind, setSourceKind] = React.useState<SopSourceKind>("prompt");
  const [sourceText, setSourceText] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const [draft, setDraft] = React.useState<SopDraftOutput | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [duplicates, setDuplicates] = React.useState<{ title: string; href: string; score: number }[]>([]);
  const [saved, setSaved] = React.useState<{ id: string; href: string } | null>(null);

  async function handleGenerate() {
    if (sourceText.trim().length < 10) {
      toast.error("Add a bit more source material first.");
      return;
    }
    setGenerating(true);
    try {
      const result = await generateSopDraftAction({ source: { kind: sourceKind, text: sourceText } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDraft(result.data);
      setStep("review");

      const similar = await findSimilarContentAction(result.data.title, result.data.summary);
      if (similar.ok) setDuplicates(similar.data);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!draft) return;
    if (!draft.title.trim()) {
      toast.error("Give this SOP a title.");
      return;
    }
    setSaving(true);
    try {
      const input: SaveSopDraftInput = {
        title: draft.title,
        summary: draft.summary,
        category: draft.category,
        meta: draft.meta,
        blocks: draft.blocks,
      };
      const result = await saveSopDraftAction(input);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSaved(result.data);
      toast.success("Saved as a draft SOP.");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-success-50 text-success-700">
            <Glyph name="check" className="h-5 w-5" />
          </div>
          <p className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">Draft SOP saved</p>
          <p className="max-w-sm text-[0.8125rem] text-[var(--text-muted)]">
            It&apos;s saved as a draft — nothing is published or visible to learners yet.
          </p>
          <div className="mt-2 flex gap-2">
            <Link
              href={saved.href}
              className="inline-flex h-9.5 items-center justify-center rounded-md bg-[var(--brand-primary)] px-4 text-sm font-medium text-white hover:bg-[var(--brand-primary-hover)]"
            >
              Continue editing
            </Link>
            <Link
              href="/admin/ai-studio/sop"
              className="inline-flex h-9.5 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-4 text-sm font-medium hover:bg-[var(--surface-sunken)]"
            >
              Draft another
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === "source") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Source material</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!available && (
            <p className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-800">
              AI text generation isn&apos;t configured — generation will fail until an administrator sets an API key.
            </p>
          )}
          <Field label="What are you starting from?" htmlFor="source-kind">
            <Select
              id="source-kind"
              value={sourceKind}
              onChange={(e) => setSourceKind(e.target.value as SopSourceKind)}
            >
              {SOURCE_KINDS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Source text" htmlFor="source-text" hint="The more detail you give it, the fewer placeholders it needs to leave for you.">
            <Textarea
              id="source-text"
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder={SOURCE_KINDS.find((s) => s.value === sourceKind)?.placeholder}
              rows={10}
            />
          </Field>
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={handleGenerate} loading={generating}>
            <Glyph name="sparkle" className="h-4 w-4" />
            Generate draft
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!draft) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <AiGeneratedBadge />
        <Button variant="ghost" size="sm" onClick={() => setStep("source")}>
          <Glyph name="arrow-left" className="h-4 w-4" />
          Back to source
        </Button>
      </div>

      {duplicates.length > 0 && (
        <Card className="border-warning-200 bg-warning-50">
          <CardContent className="py-3.5">
            <p className="mb-1.5 text-[0.8125rem] font-semibold text-warning-800">Similar content already exists</p>
            <ul className="flex flex-col gap-1">
              {duplicates.slice(0, 3).map((d) => (
                <li key={d.href}>
                  <Link href={d.href} className="text-[0.8125rem] text-warning-800 underline hover:no-underline">
                    {d.title}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="Title" htmlFor="sop-title" required>
            <Input id="sop-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Summary" htmlFor="sop-summary">
              <Textarea
                id="sop-summary"
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                rows={2}
              />
            </Field>
            <Field label="Category" htmlFor="sop-category">
              <Input
                id="sop-category"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Meta</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Purpose" htmlFor="meta-purpose">
              <Textarea
                id="meta-purpose"
                value={draft.meta.purpose}
                onChange={(e) => setDraft({ ...draft, meta: { ...draft.meta, purpose: e.target.value } })}
                rows={3}
              />
            </Field>
            <Field label="Scope" htmlFor="meta-scope">
              <Textarea
                id="meta-scope"
                value={draft.meta.scope}
                onChange={(e) => setDraft({ ...draft, meta: { ...draft.meta, scope: e.target.value } })}
                rows={3}
              />
            </Field>
          </div>
          <Field label="Safety considerations" htmlFor="meta-safety">
            <Textarea
              id="meta-safety"
              value={draft.meta.safetyConsiderations}
              onChange={(e) => setDraft({ ...draft, meta: { ...draft.meta, safetyConsiderations: e.target.value } })}
              rows={2}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Prerequisites" htmlFor="meta-prereq" hint="One per line">
              <Textarea
                id="meta-prereq"
                value={draft.meta.prerequisites.join("\n")}
                onChange={(e) => setDraft({ ...draft, meta: { ...draft.meta, prerequisites: parseLines(e.target.value) } })}
                rows={3}
              />
            </Field>
            <Field label="Required tools" htmlFor="meta-tools" hint="One per line">
              <Textarea
                id="meta-tools"
                value={draft.meta.requiredTools.join("\n")}
                onChange={(e) => setDraft({ ...draft, meta: { ...draft.meta, requiredTools: parseLines(e.target.value) } })}
                rows={3}
              />
            </Field>
          </div>
          <Field label="Definitions" htmlFor="meta-defs" hint="One per line, as: term: definition">
            <Textarea
              id="meta-defs"
              value={definitionsToText(draft.meta.definitions)}
              onChange={(e) => setDraft({ ...draft, meta: { ...draft.meta, definitions: parseDefinitions(e.target.value) } })}
              rows={3}
            />
          </Field>
          <Field label="Troubleshooting" htmlFor="meta-trouble" hint="One per line, as: problem | resolution">
            <Textarea
              id="meta-trouble"
              value={troubleshootingToText(draft.meta.troubleshooting)}
              onChange={(e) => setDraft({ ...draft, meta: { ...draft.meta, troubleshooting: parseTroubleshooting(e.target.value) } })}
              rows={3}
            />
          </Field>
          <Field label="Exceptions" htmlFor="meta-exceptions">
            <Textarea
              id="meta-exceptions"
              value={draft.meta.exceptions}
              onChange={(e) => setDraft({ ...draft, meta: { ...draft.meta, exceptions: e.target.value } })}
              rows={2}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Content</CardTitle>
        </CardHeader>
        <CardContent>
          <BlockEditor blocks={draft.blocks} onChange={(blocks: Block[]) => setDraft({ ...draft, blocks })} />
        </CardContent>
      </Card>

      {draft.blocks.length === 0 && (
        <EmptyState
          icon={<Icon name="sop" className="h-5 w-5" />}
          title="No procedure steps yet"
          description="Add at least one block above before saving."
        />
      )}

      <div className="flex justify-end gap-2 pb-8">
        <Button variant="outline" onClick={() => setStep("source")}>
          Start over
        </Button>
        <Button onClick={handleSave} loading={saving}>
          Save as draft
        </Button>
      </div>
    </div>
  );
}
