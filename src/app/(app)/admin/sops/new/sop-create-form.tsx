"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Glyph } from "@/components/icons";
import { BlockEditor } from "@/components/editor/block-editor";
import { hasBlockingIssues, validateBlocksForPublish } from "@/components/editor/validation";
import { SopIdentityFields, type SopIdentityValue } from "@/app/(app)/admin/sops/sop-identity-fields";
import { SopMetaEditor } from "@/app/(app)/admin/sops/sop-meta-editor";
import { EMPTY_SOP_META, type Block, type SopMeta } from "@/lib/content/types";
import type { PersonRef } from "@/lib/services/sop";
import { createSopAction, findSimilarTitlesAction } from "@/app/(app)/admin/sops/new/actions";

interface SimilarSop {
  id: string;
  title: string;
  sopCode: string;
  status: string;
}

export function SopCreateForm({
  people,
  departments,
  businessUnits,
}: {
  people: PersonRef[];
  departments: { id: string; name: string }[];
  businessUnits: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [codePrefix, setCodePrefix] = useState("");
  const [kind, setKind] = useState<"SOP" | "POLICY">("SOP");
  const [identity, setIdentity] = useState<SopIdentityValue>({
    title: "",
    summary: "",
    category: "",
    departmentId: "",
    businessUnitId: "",
    ownerId: "",
    smeId: "",
    reviewerId: "",
    approverId: "",
    language: "en",
    reviewCycleDays: "",
  });
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [meta, setMeta] = useState<SopMeta>(EMPTY_SOP_META);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [similar, setSimilar] = useState<SimilarSop[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (identity.title.trim().length < 3) {
      setSimilar([]);
      return;
    }
    const handle = setTimeout(() => {
      findSimilarTitlesAction(identity.title).then((result) => {
        if (result.ok) setSimilar(result.data);
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [identity.title]);

  const issues = validateBlocksForPublish(blocks);

  function submit() {
    setErrors({});
    startTransition(async () => {
      const result = await createSopAction({
        title: identity.title,
        summary: identity.summary || undefined,
        codePrefix,
        kind,
        category: identity.category || undefined,
        departmentId: identity.departmentId || undefined,
        businessUnitId: identity.businessUnitId || undefined,
        ownerId: identity.ownerId || undefined,
        smeId: identity.smeId || undefined,
        reviewerId: identity.reviewerId || undefined,
        approverId: identity.approverId || undefined,
        language: identity.language,
        reviewCycleDays: identity.reviewCycleDays ? Number(identity.reviewCycleDays) : undefined,
        blocks,
        meta,
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success("SOP created as a draft.");
      router.push(`/admin/sops/${result.data.id}/edit`);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {similar.length > 0 && (
        <div role="status" className="rounded-md border border-warning-100 bg-warning-50 px-4 py-3 text-[0.8125rem] text-warning-700">
          <p className="font-semibold">This might already exist:</p>
          <ul className="mt-1 list-disc pl-5">
            {similar.map((s) => (
              <li key={s.id}>
                <a href={`/admin/sops/${s.id}/edit`} className="underline">
                  {s.sopCode} — {s.title}
                </a>{" "}
                ({s.status.replace(/_/g, " ")})
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>SOP details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Code prefix" htmlFor="sop-code-prefix" required hint="e.g. OPS, SALES, HR — becomes OPS-001." error={errors.codePrefix}>
              <Input id="sop-code-prefix" value={codePrefix} onChange={(e) => setCodePrefix(e.target.value.toUpperCase())} maxLength={12} />
            </Field>
            <Field label="Type" htmlFor="sop-kind">
              <Select id="sop-kind" value={kind} onChange={(e) => setKind(e.target.value as "SOP" | "POLICY")}>
                <option value="SOP">SOP</option>
                <option value="POLICY">Policy</option>
              </Select>
            </Field>
          </div>
          <SopIdentityFields
            value={identity}
            onChange={(patch) => setIdentity((v) => ({ ...v, ...patch }))}
            people={people}
            departments={departments}
            businessUnits={businessUnits}
            titleError={errors.title}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Content</CardTitle>
        </CardHeader>
        <CardContent>
          <BlockEditor blocks={blocks} onChange={setBlocks} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Structured details</CardTitle>
        </CardHeader>
        <CardContent>
          <SopMetaEditor value={meta} onChange={setMeta} />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        {hasBlockingIssues(issues) && (
          <p className="text-[0.75rem] text-danger-700">Fix the highlighted content issues before creating.</p>
        )}
        <Button onClick={submit} loading={pending} disabled={!codePrefix || identity.title.trim().length < 3}>
          <Glyph name="plus" className="h-4 w-4" />
          Create SOP
        </Button>
      </div>
    </div>
  );
}
