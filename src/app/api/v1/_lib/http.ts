/** Shared pagination and response-envelope helpers for the v1 REST API. */

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function parsePagination(url: URL): PageParams {
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get("pageSize")) || 25)));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function listEnvelope<T>(data: T[], page: PageParams, total: number) {
  return Response.json({
    data,
    pagination: { page: page.page, pageSize: page.pageSize, total, totalPages: Math.max(1, Math.ceil(total / page.pageSize)) },
  });
}

export function itemEnvelope<T>(data: T): Response {
  return Response.json({ data });
}

export function notFound(resource: string): Response {
  return Response.json({ error: { code: "not_found", message: `${resource} not found.` } }, { status: 404 });
}

export function badRequest(message: string): Response {
  return Response.json({ error: { code: "bad_request", message } }, { status: 400 });
}
