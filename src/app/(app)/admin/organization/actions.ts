"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, type ActionResult } from "@/lib/action-result";
import {
  createBusinessUnit,
  createDepartment,
  createLocation,
  createPosition,
  createTeam,
  setPositionSkillRequirements,
  setPositionTrainingRequirements,
  updateBusinessUnit,
  updateDepartment,
  updateLocation,
  updatePosition,
  updateTeam,
  type BusinessUnitInput,
  type DepartmentInput,
  type LocationInput,
  type PositionInput,
  type SkillRequirementInput,
  type TeamInput,
  type TrainingRequirementInput,
} from "@/lib/services/org";

function refresh() {
  revalidatePath("/admin/organization");
  revalidatePath("/admin/organization/chart");
}

export async function createBusinessUnitAction(input: BusinessUnitInput): Promise<ActionResult> {
  return runAction("org.create_bu", async () => {
    if (!input.name || !input.slug) return fail("Name and slug are required.");
    const actor = await assertPermission("org.manage");
    await createBusinessUnit(actor, input);
    refresh();
    return ok();
  });
}

export async function updateBusinessUnitAction(id: string, input: Partial<BusinessUnitInput>): Promise<ActionResult> {
  return runAction("org.update_bu", async () => {
    const actor = await assertPermission("org.manage");
    await updateBusinessUnit(actor, id, input);
    refresh();
    return ok();
  });
}

export async function createDepartmentAction(input: DepartmentInput): Promise<ActionResult> {
  return runAction("org.create_department", async () => {
    if (!input.name || !input.businessUnitId) return fail("Name and business unit are required.");
    const actor = await assertPermission("org.manage");
    await createDepartment(actor, input);
    refresh();
    return ok();
  });
}

export async function updateDepartmentAction(id: string, input: Partial<DepartmentInput>): Promise<ActionResult> {
  return runAction("org.update_department", async () => {
    const actor = await assertPermission("org.manage");
    await updateDepartment(actor, id, input);
    refresh();
    return ok();
  });
}

export async function createTeamAction(input: TeamInput): Promise<ActionResult> {
  return runAction("org.create_team", async () => {
    if (!input.name || !input.departmentId) return fail("Name and department are required.");
    const actor = await assertPermission("org.manage");
    await createTeam(actor, input);
    refresh();
    return ok();
  });
}

export async function updateTeamAction(id: string, input: Partial<TeamInput>): Promise<ActionResult> {
  return runAction("org.update_team", async () => {
    const actor = await assertPermission("org.manage");
    await updateTeam(actor, id, input);
    refresh();
    return ok();
  });
}

export async function createLocationAction(input: LocationInput): Promise<ActionResult> {
  return runAction("org.create_location", async () => {
    if (!input.name || !input.country) return fail("Name and country are required.");
    const actor = await assertPermission("org.manage");
    await createLocation(actor, input);
    refresh();
    return ok();
  });
}

export async function updateLocationAction(id: string, input: Partial<LocationInput>): Promise<ActionResult> {
  return runAction("org.update_location", async () => {
    const actor = await assertPermission("org.manage");
    await updateLocation(actor, id, input);
    refresh();
    return ok();
  });
}

export async function createPositionAction(input: PositionInput): Promise<ActionResult<{ id: string }>> {
  return runAction("org.create_position", async () => {
    if (!input.title) return fail("Title is required.");
    const actor = await assertPermission("org.manage");
    const position = await createPosition(actor, input);
    refresh();
    return ok({ id: position.id });
  });
}

export async function updatePositionAction(id: string, input: Partial<PositionInput>): Promise<ActionResult> {
  return runAction("org.update_position", async () => {
    const actor = await assertPermission("org.manage");
    await updatePosition(actor, id, input);
    refresh();
    revalidatePath(`/admin/organization/positions/${id}`);
    return ok();
  });
}

export async function setPositionSkillRequirementsAction(
  positionId: string,
  requirements: SkillRequirementInput[],
): Promise<ActionResult> {
  return runAction("org.set_position_skills", async () => {
    const actor = await assertPermission("org.manage");
    await setPositionSkillRequirements(actor, positionId, requirements);
    revalidatePath(`/admin/organization/positions/${positionId}`);
    return ok();
  });
}

export async function setPositionTrainingRequirementsAction(
  positionId: string,
  requirements: TrainingRequirementInput[],
): Promise<ActionResult> {
  return runAction("org.set_position_training", async () => {
    const actor = await assertPermission("org.manage");
    await setPositionTrainingRequirements(actor, positionId, requirements);
    revalidatePath(`/admin/organization/positions/${positionId}`);
    return ok();
  });
}
