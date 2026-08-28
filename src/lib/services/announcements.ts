import "server-only";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import type { Prisma } from "@prisma/client";

/**
 * Announcement CRUD, targeting, and acknowledgement reporting.
 *
 * Targeting is single-dimension by design (matches the admin UI's radio
 * choice): an announcement targets everyone, or exactly one of business unit,
 * department, team, location, or role.
 */

export type AnnouncementTargetMode = "everyone" | "businessUnit" | "department" | "team" | "location" | "role";

export interface AnnouncementInput {
  title: string;
  body: string;
  targetMode: AnnouncementTargetMode;
  targetId?: string | null; // businessUnitId / departmentId / teamId / locationId / roleKey depending on mode
  startsAt: Date;
  expiresAt?: Date | null;
  pinned: boolean;
  requiresAck: boolean;
}

function targetFieldsFromInput(input: AnnouncementInput): {
  businessUnitId: string | null;
  departmentId: string | null;
  teamId: string | null;
  locationId: string | null;
  roleKey: string | null;
} {
  const empty = { businessUnitId: null, departmentId: null, teamId: null, locationId: null, roleKey: null };
  switch (input.targetMode) {
    case "businessUnit":
      return { ...empty, businessUnitId: input.targetId ?? null };
    case "department":
      return { ...empty, departmentId: input.targetId ?? null };
    case "team":
      return { ...empty, teamId: input.targetId ?? null };
    case "location":
      return { ...empty, locationId: input.targetId ?? null };
    case "role":
      return { ...empty, roleKey: input.targetId ?? null };
    default:
      return empty;
  }
}

export function targetModeFromAnnouncement(a: {
  businessUnitId: string | null;
  departmentId: string | null;
  teamId: string | null;
  locationId: string | null;
  roleKey: string | null;
}): AnnouncementTargetMode {
  if (a.businessUnitId) return "businessUnit";
  if (a.departmentId) return "department";
  if (a.teamId) return "team";
  if (a.locationId) return "location";
  if (a.roleKey) return "role";
  return "everyone";
}

export async function createAnnouncement(actor: Actor, input: AnnouncementInput) {
  const announcement = await prisma.announcement.create({
    data: {
      title: input.title,
      body: input.body,
      authorId: actor.id,
      startsAt: input.startsAt,
      expiresAt: input.expiresAt ?? null,
      pinned: input.pinned,
      requiresAck: input.requiresAck,
      ...targetFieldsFromInput(input),
    },
  });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "announcement.created",
    entityType: "ANNOUNCEMENT",
    entityId: announcement.id,
    metadata: { title: input.title, targetMode: input.targetMode },
  });
  return announcement;
}

export async function updateAnnouncement(actor: Actor, id: string, input: AnnouncementInput) {
  const announcement = await prisma.announcement.update({
    where: { id },
    data: {
      title: input.title,
      body: input.body,
      startsAt: input.startsAt,
      expiresAt: input.expiresAt ?? null,
      pinned: input.pinned,
      requiresAck: input.requiresAck,
      ...targetFieldsFromInput(input),
    },
  });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "announcement.updated",
    entityType: "ANNOUNCEMENT",
    entityId: id,
    metadata: { title: input.title, targetMode: input.targetMode },
  });
  return announcement;
}

export async function deleteAnnouncement(actor: Actor, id: string): Promise<void> {
  await prisma.announcement.delete({ where: { id } });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "announcement.deleted",
    entityType: "ANNOUNCEMENT",
    entityId: id,
  });
}

export async function listAnnouncementsForAdmin(params: { page?: number; pageSize?: number; q?: string }) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 20));
  const where: Prisma.AnnouncementWhereInput = params.q
    ? { OR: [{ title: { contains: params.q, mode: "insensitive" } }, { body: { contains: params.q, mode: "insensitive" } }] }
    : {};

  const [rows, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { startsAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { acks: true } } },
    }),
    prisma.announcement.count({ where }),
  ]);

  return { items: rows, total, page, pageSize };
}

export async function getAnnouncement(id: string) {
  return prisma.announcement.findUnique({ where: { id } });
}

/** Where-clause fragment matching announcements visible to a given actor right now. */
function visibilityWhere(actor: Actor, now: Date): Prisma.AnnouncementWhereInput {
  const targetConditions: Prisma.AnnouncementWhereInput[] = [
    { businessUnitId: null, departmentId: null, teamId: null, locationId: null, roleKey: null },
  ];
  if (actor.businessUnitId) targetConditions.push({ businessUnitId: actor.businessUnitId });
  if (actor.departmentId) targetConditions.push({ departmentId: actor.departmentId });
  if (actor.teamId) targetConditions.push({ teamId: actor.teamId });
  if (actor.locationId) targetConditions.push({ locationId: actor.locationId });
  for (const roleKey of actor.roleKeys) targetConditions.push({ roleKey });

  return {
    AND: [
      { startsAt: { lte: now } },
      { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
      { OR: targetConditions },
    ],
  };
}

export interface ActiveAnnouncement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  requiresAck: boolean;
  startsAt: Date;
  expiresAt: Date | null;
  acknowledged: boolean;
}

/** Announcements visible to this actor right now, most relevant first. */
export async function listActiveAnnouncementsForActor(actor: Actor, limit = 10): Promise<ActiveAnnouncement[]> {
  const now = new Date();
  const rows = await prisma.announcement.findMany({
    where: visibilityWhere(actor, now),
    orderBy: [{ pinned: "desc" }, { startsAt: "desc" }],
    take: limit,
    include: { acks: { where: { userId: actor.id }, select: { userId: true } } },
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    pinned: r.pinned,
    requiresAck: r.requiresAck,
    startsAt: r.startsAt,
    expiresAt: r.expiresAt,
    acknowledged: r.acks.length > 0,
  }));
}

export async function acknowledgeAnnouncement(userId: string, announcementId: string): Promise<void> {
  await prisma.announcementAck.upsert({
    where: { announcementId_userId: { announcementId, userId } },
    create: { announcementId, userId },
    update: {},
  });
}

/** Users matching an announcement's own targeting, used to compute the ack rate. */
function targetedUserWhere(announcement: {
  businessUnitId: string | null;
  departmentId: string | null;
  teamId: string | null;
  locationId: string | null;
  roleKey: string | null;
}): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = { status: "ACTIVE" };
  if (announcement.businessUnitId) return { ...base, businessUnitId: announcement.businessUnitId };
  if (announcement.departmentId) return { ...base, departmentId: announcement.departmentId };
  if (announcement.teamId) return { ...base, teamId: announcement.teamId };
  if (announcement.locationId) return { ...base, locationId: announcement.locationId };
  if (announcement.roleKey) return { ...base, roles: { some: { role: { key: announcement.roleKey } } } };
  return base;
}

export interface AcknowledgementReport {
  targetedCount: number;
  acknowledgedCount: number;
  rate: number;
  outstanding: { id: string; name: string; email: string; department: string | null }[];
  outstandingTotal: number;
}

export async function getAcknowledgementReport(
  announcementId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<AcknowledgementReport | null> {
  const announcement = await prisma.announcement.findUnique({ where: { id: announcementId } });
  if (!announcement) return null;

  const where = targetedUserWhere(announcement);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 25));

  const [targetedCount, acknowledgedCount, outstandingTotal, outstanding] = await Promise.all([
    prisma.user.count({ where }),
    prisma.announcementAck.count({ where: { announcementId, user: where } }),
    prisma.user.count({ where: { ...where, announcementAcks: { none: { announcementId } } } }),
    prisma.user.findMany({
      where: { ...where, announcementAcks: { none: { announcementId } } },
      select: { id: true, name: true, email: true, department: { select: { name: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    targetedCount,
    acknowledgedCount,
    rate: targetedCount > 0 ? Math.round((acknowledgedCount / targetedCount) * 100) : 0,
    outstanding: outstanding.map((u) => ({ id: u.id, name: u.name, email: u.email, department: u.department?.name ?? null })),
    outstandingTotal,
  };
}
