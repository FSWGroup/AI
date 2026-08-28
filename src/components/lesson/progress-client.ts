"use client";

/** POST a progress patch for a lesson. Throws with a user-presentable message on failure. */
export async function postProgress(
  lessonId: string,
  patch: Record<string, unknown>,
): Promise<{
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  videoPositionSeconds: number | null;
  videoWatchedPercent: number | null;
  checklistState: Record<string, unknown> | null;
  completedAt: string | null;
  courseCompleted: boolean;
}> {
  const response = await fetch("/api/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lessonId, ...patch }),
  });

  let json: { ok: boolean; data?: unknown; error?: string } | null = null;
  try {
    json = await response.json();
  } catch {
    // no body
  }

  if (!response.ok || !json?.ok) {
    throw new Error(json?.error ?? "Something went wrong updating your progress.");
  }
  return json.data as never;
}
