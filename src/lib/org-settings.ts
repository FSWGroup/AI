import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";

/** Shown wherever an organization has not set a name of its own. */
export const DEFAULT_COMPANY_NAME = "FSW Group";

/**
 * The single org-settings row (id "org"), cached for one request.
 *
 * A dozen render paths want one field off this row, and the careers pages
 * want the company name twice each — once in `generateMetadata` and once in
 * the page body — which was two identical queries per page view. `cache()`
 * collapses all of them to one.
 *
 * READ-ONLY. Anything that writes settings must query and upsert against
 * prisma directly: a handler that read through this cache and then wrote
 * would compare its new values against a snapshot taken earlier in the same
 * request, and the settings audit entry would record the wrong "before".
 */
export const getOrgSettings = cache(async () => {
  return prisma.orgSettings.findUnique({ where: { id: "org" } });
});

/** The organization's name, or the default. */
export async function getCompanyName(): Promise<string> {
  const settings = await getOrgSettings();
  return settings?.companyName ?? DEFAULT_COMPANY_NAME;
}
