"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertPermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { ok, fail, runAction, type ActionResult } from "@/lib/action-result";
import {
  createPath,
  updatePath,
  addItem,
  updateItem,
  deleteItem,
  reorderItems,
  publishPath,
  archivePath,
  assignPath,
  ServiceError,
  pathInputSchema,
  pathItemInputSchema,
} from "@/lib/services/path";

async function withPathGuard<T>(pathId: string, body: () => Promise<T>): Promise<ActionResult<T>> {
  return runAction("paths.edit", async () => {
    try {
      const data = await body();
      revalidatePath(`/admin/paths/${pathId}/edit`);
      revalidatePath("/admin/paths");
      return ok(data);
    } catch (error) {
      if (error instanceof ServiceError) return fail(error.message);
      throw error;
    }
  });
}

export async function createPathAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction("paths.create", async () => {
    const actor = await assertPermission("path.create");
    const parsed = pathInputSchema.pick({ title: true, description: true }).safeParse({
      title: formData.get("title"),
      description: formData.get("description") || undefined,
    });
    if (!parsed.success) return fail("Add a title.");
    try {
      const path = await createPath(actor, parsed.data);
      revalidatePath("/admin/paths");
      return ok({ id: path.id });
    } catch (error) {
      if (error instanceof ServiceError) return fail(error.message);
      throw error;
    }
  });
}

export async function createPathAndRedirect(formData: FormData): Promise<void> {
  const result = await createPathAction(formData);
  if (result.ok) redirect(`/admin/paths/${result.data.id}/edit`);
}

export async function updatePathMetaAction(pathId: string, formData: FormData): Promise<ActionResult> {
  return withPathGuard(pathId, async () => {
    const actor = await assertPermission("path.create");
    const parsed = pathInputSchema.partial().parse({
      title: formData.get("title") || undefined,
      description: formData.get("description") || undefined,
    });
    await updatePath(actor, pathId, parsed);
    return undefined;
  });
}

export async function addPathItemAction(pathId: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return withPathGuard(pathId, async () => {
    const actor = await assertPermission("path.create");
    const parsed = pathItemInputSchema.parse(input);
    const item = await addItem(actor, pathId, parsed);
    return { id: item.id };
  });
}

export async function updatePathItemAction(pathId: string, itemId: string, input: unknown): Promise<ActionResult> {
  return withPathGuard(pathId, async () => {
    const actor = await assertPermission("path.create");
    await updateItem(actor, itemId, input);
    return undefined;
  });
}

export async function deletePathItemAction(pathId: string, itemId: string): Promise<ActionResult> {
  return withPathGuard(pathId, async () => {
    const actor = await assertPermission("path.create");
    await deleteItem(actor, itemId);
    return undefined;
  });
}

export async function reorderPathItemsAction(pathId: string, orderedIds: string[]): Promise<ActionResult> {
  return withPathGuard(pathId, async () => {
    const actor = await assertPermission("path.create");
    await reorderItems(actor, pathId, orderedIds);
    return undefined;
  });
}

export async function publishPathAction(pathId: string): Promise<ActionResult> {
  return withPathGuard(pathId, async () => {
    const actor = await assertPermission("path.publish");
    await publishPath(actor, pathId);
    return undefined;
  });
}

export async function archivePathAction(pathId: string): Promise<ActionResult> {
  return withPathGuard(pathId, async () => {
    const actor = await assertPermission("training.archive");
    await archivePath(actor, pathId);
    return undefined;
  });
}

export async function assignPathAction(pathId: string, userIds: string[]): Promise<ActionResult<{ assigned: number }>> {
  return withPathGuard(pathId, async () => {
    const actor = await assertPermission("training.assign");
    const result = await assignPath(actor, pathId, userIds);
    return { assigned: result.parentAssignmentIds.length };
  });
}

export async function searchUsersAction(query: string): Promise<{ id: string; name: string; email: string }[]> {
  await assertPermission("training.assign");
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  return prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ name: { contains: trimmed, mode: "insensitive" } }, { email: { contains: trimmed, mode: "insensitive" } }],
    },
    select: { id: true, name: true, email: true },
    take: 20,
    orderBy: { name: "asc" },
  });
}

export async function listCoursesForPicker(): Promise<{ id: string; title: string }[]> {
  await assertPermission("path.create");
  return prisma.course.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
    take: 500,
  });
}

export async function listSopsForPathPicker(): Promise<{ id: string; code: string; title: string }[]> {
  await assertPermission("path.create");
  const sops = await prisma.sop.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, sopCode: true, title: true },
    orderBy: { sopCode: "asc" },
    take: 500,
  });
  return sops.map((s) => ({ id: s.id, code: s.sopCode, title: s.title }));
}
