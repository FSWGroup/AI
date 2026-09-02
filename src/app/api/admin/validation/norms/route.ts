/**
 * Norm tables: preview what one would look like, and generate drafts.
 *
 * Generation never activates. Everything created here is a draft until a
 * human looks at how many existing candidates would change band and decides
 * to accept that.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { generateNormTables, previewNormTables } from "@/lib/validation/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const generateSchema = z.object({
  population: z.enum(["APPLICANTS", "HIRES"]).default("APPLICANTS"),
  jobProfileId: z.string().min(1).nullish(),
  studyId: z.string().min(1).nullish(),
  constructs: z.array(z.string()).optional(),
});

export const GET = withErrorHandling(async (req) => {
  await requirePermission("VIEW_VALIDATION");
  const url = new URL(req.url);
  const population = url.searchParams.get("population") === "HIRES" ? "HIRES" : "APPLICANTS";
  const jobProfileId = url.searchParams.get("jobProfileId");

  const [previews, tables] = await Promise.all([
    previewNormTables({ population, jobProfileId }),
    prisma.normTable.findMany({
      orderBy: [{ construct: "asc" }, { effectiveDate: "desc" }],
    }),
  ]);

  return apiOk({
    previews: previews.map((p) => ({
      construct: p.construct,
      label: p.label,
      sampleSize: p.sampleSize,
      gate: p.table?.gate ?? "BLOCKED",
      thresholds: p.table?.thresholds ?? null,
      warnings: p.table?.warnings ?? [],
      shift: p.shift,
      reason: p.reason ?? null,
    })),
    tables: tables.map((t) => ({
      id: t.id,
      construct: t.construct,
      status: t.status,
      sampleSize: t.sampleSize,
      population: t.population,
      effectiveDate: t.effectiveDate,
    })),
  });
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("MANAGE_VALIDATION");
  const body = await parseBody(req, generateSchema);
  const out = await generateNormTables({
    population: body.population ?? "APPLICANTS",
    jobProfileId: body.jobProfileId ?? null,
    studyId: body.studyId ?? null,
    constructs: body.constructs as never,
    actorId: user.id,
  });
  return apiOk(out, { status: 201 });
});
