import { getActor } from "@/lib/auth/guard";
import { search, recordSearch, type SearchEntityType } from "@/lib/search";
import { track } from "@/lib/services/analytics";

const VALID_TYPES: SearchEntityType[] = ["SOP", "COURSE", "LESSON", "LEARNING_PATH", "PERSON", "SKILL", "VIDEO"];

export async function GET(request: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const typesParam = url.searchParams.get("types");
  const types = typesParam
    ? (typesParam
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter((t): t is SearchEntityType => (VALID_TYPES as string[]).includes(t)) as SearchEntityType[])
    : undefined;

  if (q.length < 2) {
    return Response.json({ results: [] });
  }

  const results = await search(actor, q, { types, limit });

  await Promise.all([
    recordSearch(actor.id, q, results.length),
    track(actor.id, "search_performed", undefined, { resultCount: results.length, hadResults: results.length > 0 }),
  ]);

  return Response.json({ results });
}
