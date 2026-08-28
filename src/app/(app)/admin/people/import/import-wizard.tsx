"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Glyph } from "@/components/icons";
import {
  commitImportAction,
  downloadRejectedCsvAction,
  parseImportFileAction,
  validateImportAction,
} from "@/app/(app)/admin/people/import/actions";
import type { ImportMapping, ImportPreview } from "@/lib/services/people";

type Step = "upload" | "map" | "preview" | "done";

const MAPPING_FIELDS: { key: keyof ImportMapping; label: string; required?: boolean }[] = [
  { key: "email", label: "Work email", required: true },
  { key: "name", label: "Full name", required: true },
  { key: "title", label: "Title" },
  { key: "employeeId", label: "Employee ID" },
  { key: "workerType", label: "Worker type" },
  { key: "country", label: "Country" },
  { key: "state", label: "State / province" },
  { key: "businessUnitSlug", label: "Business unit slug" },
  { key: "departmentName", label: "Department name" },
  { key: "teamName", label: "Team name" },
  { key: "positionTitle", label: "Position title" },
  { key: "locationName", label: "Location name" },
  { key: "managerEmail", label: "Manager email" },
  { key: "startDate", label: "Start date" },
];

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ImportWizard() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState<Step>("upload");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [sample, setSample] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ImportMapping>({ email: "", name: "" });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [commitResult, setCommitResult] = useState<{ committed: number; failed: number } | null>(null);

  function onFileChosen(file: File) {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      startTransition(async () => {
        const result = await parseImportFileAction(text);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setHeaders(result.data.headers);
        setRowCount(result.data.rowCount);
        setSample(result.data.sample);
        // Best-effort auto-map by exact/loose header name match.
        const auto: ImportMapping = { email: "", name: "" };
        for (const field of MAPPING_FIELDS) {
          const match = result.data.headers.find((h) => h.toLowerCase().replace(/[^a-z]/g, "") === field.key.toLowerCase());
          if (match) (auto as unknown as Record<string, string>)[field.key] = match;
        }
        setMapping(auto);
        setStep("map");
      });
    };
    reader.readAsText(file);
  }

  function runValidate() {
    startTransition(async () => {
      const result = await validateImportAction(csvText, mapping);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPreview(result.data);
      setStep("preview");
    });
  }

  function runCommit() {
    if (!preview) return;
    startTransition(async () => {
      const result = await commitImportAction(preview.valid);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCommitResult({ committed: result.data.committed.length, failed: result.data.failed.length });
      setStep("done");
      router.refresh();
    });
  }

  function runDownloadRejected() {
    if (!preview) return;
    startTransition(async () => {
      const result = await downloadRejectedCsvAction(preview.rejected, headers);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      downloadText("rejected-rows.csv", result.data, "text/csv");
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-wrap items-center gap-2 text-[0.75rem] text-[var(--text-muted)]">
        {(["upload", "map", "preview", "done"] as Step[]).map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            {i > 0 && <Glyph name="chevron-right" className="h-3 w-3" />}
            <span
              className={
                s === step ? "font-semibold text-[var(--text-primary)]" : ["upload", "map", "preview"].indexOf(s) < ["upload", "map", "preview"].indexOf(step) || step === "done" ? "text-[var(--text-secondary)]" : ""
              }
            >
              {i + 1}. {s === "upload" ? "Upload" : s === "map" ? "Map columns" : s === "preview" ? "Validate" : "Commit"}
            </span>
          </li>
        ))}
      </ol>

      {step === "upload" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Glyph name="upload" className="h-8 w-8 text-[var(--text-muted)]" />
            <p className="text-[0.9375rem] font-medium text-[var(--text-primary)]">Upload a CSV file</p>
            <p className="max-w-md text-[0.8125rem] text-[var(--text-muted)]">
              The first row must contain column headers. You&apos;ll map columns to fields on the next step.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFileChosen(file);
              }}
            />
            <Button onClick={() => fileInput.current?.click()} loading={pending}>
              Choose file
            </Button>
          </CardContent>
        </Card>
      )}

      {step === "map" && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <p className="text-[0.8125rem] text-[var(--text-muted)]">
              {fileName} · {rowCount} data row{rowCount === 1 ? "" : "s"} detected. Map each field to a column (leave blank to skip
              optional fields).
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MAPPING_FIELDS.map((field) => (
                <Field key={field.key} label={field.label} htmlFor={`map-${field.key}`} required={field.required}>
                  <Select
                    id={`map-${field.key}`}
                    value={mapping[field.key] ?? ""}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  >
                    <option value="">— Not mapped —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>

            {sample.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
                <table className="w-full border-collapse text-[0.75rem]">
                  <thead>
                    <tr className="bg-[var(--surface-sunken)]">
                      {headers.map((h) => (
                        <th key={h} scope="col" className="border-b border-[var(--border-subtle)] p-2 text-left">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sample.map((row, i) => (
                      <tr key={i}>
                        {headers.map((h) => (
                          <td key={h} className="border-b border-[var(--border-subtle)] p-2 text-[var(--text-muted)]">
                            {row[h]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button onClick={runValidate} loading={pending} disabled={!mapping.email || !mapping.name}>
                Validate rows
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "preview" && preview && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">{preview.valid.length} valid</Badge>
              <Badge tone={preview.rejected.length > 0 ? "danger" : "neutral"}>{preview.rejected.length} rejected</Badge>
              {preview.rejected.length > 0 && (
                <Button variant="outline" size="sm" onClick={runDownloadRejected} loading={pending}>
                  <Glyph name="download" className="h-3.5 w-3.5" /> Download rejected rows CSV
                </Button>
              )}
            </div>

            {preview.rejected.length > 0 && (
              <div className="max-h-80 overflow-auto rounded-md border border-[var(--border-subtle)]">
                <table className="w-full border-collapse text-[0.75rem]">
                  <thead>
                    <tr className="bg-[var(--surface-sunken)]">
                      <th scope="col" className="border-b border-[var(--border-subtle)] p-2 text-left">
                        Row
                      </th>
                      <th scope="col" className="border-b border-[var(--border-subtle)] p-2 text-left">
                        Email
                      </th>
                      <th scope="col" className="border-b border-[var(--border-subtle)] p-2 text-left">
                        Errors
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rejected.map((r) => (
                      <tr key={r.rowNumber}>
                        <td className="border-b border-[var(--border-subtle)] p-2">{r.rowNumber}</td>
                        <td className="border-b border-[var(--border-subtle)] p-2">{r.data[mapping.email] ?? "—"}</td>
                        <td className="border-b border-[var(--border-subtle)] p-2 text-danger-700">{r.errors.join("; ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep("map")}>
                Back
              </Button>
              <Button onClick={runCommit} loading={pending} disabled={preview.valid.length === 0}>
                Commit {preview.valid.length} valid row{preview.valid.length === 1 ? "" : "s"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "done" && commitResult && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Glyph name="check" className="h-8 w-8 text-success-600" />
            <p className="text-[0.9375rem] font-medium text-[var(--text-primary)]">
              Imported {commitResult.committed} people{commitResult.failed > 0 ? `, ${commitResult.failed} failed` : ""}.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => router.push("/admin/people")}>
                Go to people
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStep("upload");
                  setPreview(null);
                  setCommitResult(null);
                  setCsvText("");
                }}
              >
                Import another file
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
