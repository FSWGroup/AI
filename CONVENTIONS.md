# FSW Academy — implementation conventions

Read this before adding code. These patterns are already established in the
foundation; follow them exactly so the codebase stays coherent.

## Stack

- Next.js 15 App Router, React 19, TypeScript strict (`noUncheckedIndexedAccess` on)
- Tailwind CSS v4 (tokens in `src/app/globals.css` — **never** hard-code brand colors)
- Prisma ORM + PostgreSQL (pgvector, pg_trgm)
- Auth.js v5 (`src/lib/auth/config.ts`)
- Postgres-backed job queue (`src/lib/jobs/queue.ts`) — no external queue service

## Directory layout

```
src/
  app/
    (app)/              authenticated pages — wrapped by the app shell layout
    api/                route handlers
    sign-in/            unauthenticated auth pages
  components/
    ui/                 primitives (Button, Card, Badge, Input/Field, EmptyState, Progress)
    shell/              app shell (sidebar, topbar, command palette)
  lib/
    auth/               guard.ts (authorization), config.ts (Auth.js)
    ai/                 provider interfaces + adapters
    content/            block content model
    services/           domain logic (put business rules HERE, not in pages)
```

## Authorization — non-negotiable

Every page, server action, and API route enforces permissions server-side.
UI hiding is never the control.

```ts
// Pages (redirects to /forbidden):
import { requirePermission } from "@/lib/auth/guard";
const actor = await requirePermission("sop.create");

// Server actions / API routes (throws, so you can return a structured error):
import { assertPermission } from "@/lib/auth/guard";
const actor = await assertPermission("sop.publish");
```

For per-record scoping use `canViewUser`, `canManageUser`, `getVisibleUserIds`.
A manager sees their reporting subtree; a learner sees themselves.

These live in `@/lib/auth/scope` (no session/framework dependency, so they are
importable from jobs, the REST API, and tests) and are **re-exported from
`@/lib/auth/guard`** — importing either path works. Import the `Actor` type from
whichever you already import.

Permission keys live in `src/lib/permissions.ts`. Do not invent new keys without
adding them there.

## Server actions

Put them in `actions.ts` next to the page, marked `"use server"`. Shape:

```ts
"use server";
export async function publishSop(input: unknown): Promise<ActionResult> {
  const actor = await assertPermission("sop.publish");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "…" };
  // …domain call in src/lib/services/
  await recordAudit({ actorId: actor.id, action: AUDIT_ACTIONS.SOP_PUBLISHED, ... });
  revalidatePath("/sops");
  return { ok: true };
}
```

Use `ActionResult` from `src/lib/action-result.ts`. Never throw raw errors to the
client; never leak stack traces.

## Audit

Call `recordAudit()` from `@/lib/audit` for every high-risk operation: publish,
role change, sensitive field view, completion override, certificate issue,
exemption, integration change, settings change. Metadata must be safe — no
secrets, no sensitive field values.

## Immutable evidence

These tables are append-only. Never update or delete rows:
`CompletionRecord`, `Acknowledgement`, `Certificate`, `AuditEvent`,
`SopVersion`, `CourseVersion`, `QuizAttempt`, `QuizResponse`.

Completion records carry snapshots (`userSnapshot`, `titleSnapshot`,
`versionLabel`) so they survive later content edits and deletions.

## UI patterns

```tsx
import { PageHeader, PageBody, SectionHeading } from "@/components/page-header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Icon, Glyph } from "@/components/icons";
```

- Every page: `<PageHeader title=… description=… crumbs=… actions=… />` then `<PageBody>`.
- Every empty list: `<EmptyState>` with a real next action. Never a blank screen.
- Every async action: loading state (`<Button loading>`), success + failure feedback
  via `toast` from `sonner`.
- Colors come from tokens: `text-[var(--text-primary)]`, `bg-[var(--surface-card)]`,
  `border-[var(--border-subtle)]`, `bg-[var(--brand-primary)]`. Palette steps
  (`navy-700`, `steel-100`, `success-600`) are fine; raw hex is not.
- Status is never conveyed by color alone — always include text.
- Never `window.prompt`, `window.confirm` or `window.alert`. Use `ConfirmDialog`
  or `PromptDialog` from `@/components/ui/dialog`. Native dialogs cannot be
  styled or labelled, are announced inconsistently by screen readers, are
  suppressed in some embedded contexts, and return `null` under automation — so
  a control that depends on one can silently do nothing, which the user cannot
  tell apart from a broken button.

### No file-based `loading.tsx` boundaries

There are deliberately none in this app. A `loading.tsx` above the segment being
navigated to made client-side transitions fail to commit intermittently in
production builds — links did nothing at all, with no error anywhere. A root-level
one is the worst case (it wraps the whole document, so every transition unmounts
the shell), but a route-group one still broke same-segment navigation. Server
renders are 70–120ms and Next keeps the current page visible until the next is
ready, so nothing is lost.

If a genuinely slow page needs an indicator, use a per-link pending state
(`useLinkStatus`) or a skeleton the page renders itself — not a route boundary —
and re-run the navigation probe described in `KNOWN-ISSUES.md` before merging.

## Accessibility (WCAG 2.2 AA)

- Focus is always visible; never remove outlines.
- Interactive elements are `<button>` or `<a>`, never a clickable `<div>`.
- Icons are `aria-hidden`; meaning lives in adjacent text or `sr-only`.
- Form fields use `<Field label htmlFor>` so label/hint/error are associated.
- Images need real alt text; decorative images get `alt=""`.
- Dialogs: `role="dialog"`, `aria-modal`, Escape to close, focus restored on close.
- Tables: real `<th scope>`; wrap wide tables in `overflow-x-auto`.

## Data access

- Always paginate lists server-side (`take`/`skip`); never load a full table.
- Use `select` to fetch only needed columns.
- Avoid N+1: use `include`/nested `select`, or a single `$queryRaw` with a CTE.
- Dates are stored UTC; format for display with the actor's `timezone` using
  `formatInTimeZone` from `date-fns-tz`.

## AI boundaries

- Retrieval filters by permission **before** the query, never after generation
  (see `src/lib/search.ts` and the RAG service).
- Sensitive profile fields, audit data, and credentials never enter AI context.
- AI never auto-publishes. Everything lands as `DRAFT` for human review.
- AI-generated content is visibly marked (`aiGenerated` flag, "AI-generated" badge).
- Every substantive Ask FSW AI answer carries clickable citations.

## Provider capabilities

Never assume an optional provider exists:

```ts
import { isCapabilityAvailable } from "@/lib/providers/registry";
if (!isCapabilityAvailable("ai_text")) { /* show a disabled state with guidance */ }
```

A missing provider disables only its own feature. The app must not crash.

## Testing

- Unit tests: `src/**/*.test.ts` (Vitest, `unit` project) — pure logic, no DB.
- Integration tests: `tests/integration/*.test.ts` (`integration` project) — real
  test DB via `DATABASE_URL` pointed at `fsw_academy_test`.
- E2E: `e2e/*.spec.ts` (Playwright).
