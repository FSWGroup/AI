"use server";

import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, fieldErrorsFromZod, type ActionResult } from "@/lib/action-result";
import { blocksSchema, sopMetaSchema } from "@/lib/content/types";
import {
  createSop,
  updateSopDraft,
  findSimilarSopTitles,
  createSopInputSchema,
  SopValidationError,
} from "@/lib/services/sop";

const createFormSchema = createSopInputSchema.extend({
  blocks: blocksSchema.optional(),
  meta: sopMetaSchema.partial().optional(),
});

export async function createSopAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction("sop.create_new", async () => {
    const actor = await assertPermission("sop.create");
    const parsed = createFormSchema.safeParse(input);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFromZod(parsed.error));

    try {
      const sop = await createSop(actor, parsed.data);
      if (parsed.data.blocks !== undefined || parsed.data.meta !== undefined) {
        await updateSopDraft(actor, sop.id, { blocks: parsed.data.blocks, meta: parsed.data.meta });
      }
      return ok({ id: sop.id });
    } catch (error) {
      if (error instanceof SopValidationError) return fail(error.message);
      throw error;
    }
  });
}

export async function findSimilarTitlesAction(
  title: string,
): Promise<ActionResult<{ id: string; title: string; sopCode: string; status: string }[]>> {
  return runAction("sop.find_similar", async () => {
    const actor = await assertPermission("sop.create");
    const results = await findSimilarSopTitles(actor, title);
    return ok(results);
  });
}
