/**
 * The AiAnalysis row's lifecycle, in one place.
 *
 * Every AI feature writes the same three states around its model call:
 * PENDING before it, READY with the output and token counts after it, FAILED
 * with the error if it throws. The row is created BEFORE the model is called
 * on purpose — an analysis that runs for minutes and then dies leaves a row
 * saying what failed and who asked for it, rather than nothing at all, and
 * the run was billed either way.
 */

import "server-only";
import type { AiAnalysis, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface AnalysisResult<T> {
  output: T;
  inputTokens: number;
  outputTokens: number;
}

export async function recordAnalysis<T>(params: {
  /** Everything identifying the run. `status` is set by this function. */
  create: Omit<Prisma.AiAnalysisUncheckedCreateInput, "status">;
  run: () => Promise<AnalysisResult<T>>;
  /**
   * Side effects that belong to a successful analysis — persisting the input
   * the proposal was made from, say. Runs before the row is marked READY, so
   * if it throws the row records the failure like any other.
   */
  onSuccess?: (result: AnalysisResult<T>) => Promise<void>;
}): Promise<AnalysisResult<T> & { record: AiAnalysis }> {
  const pending = await prisma.aiAnalysis.create({
    data: { ...params.create, status: "PENDING" },
  });

  try {
    const result = await params.run();
    await params.onSuccess?.(result);

    const record = await prisma.aiAnalysis.update({
      where: { id: pending.id },
      data: {
        status: "READY",
        output: result.output as unknown as Prisma.InputJsonValue,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        completedAt: new Date(),
      },
    });
    return { ...result, record };
  } catch (err) {
    await prisma.aiAnalysis.update({
      where: { id: pending.id },
      data: {
        status: "FAILED",
        error: err instanceof Error ? err.message.slice(0, 500) : "Unknown error",
        completedAt: new Date(),
      },
    });
    throw err;
  }
}
