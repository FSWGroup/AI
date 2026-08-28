# Route map

Every page and endpoint in FSW Academy, with the permission that gates it.
Authorization is enforced server-side in each route — the navigation only decides
what is *offered*.

Permission keys are defined in [`src/lib/permissions.ts`](src/lib/permissions.ts).

---

## Unauthenticated

| Route | Purpose |
|---|---|
| `/` | Redirects to `/home` when signed in, `/sign-in` otherwise |
| `/sign-in` | Sign in with password, magic link, or Microsoft SSO — only configured providers appear |
| `/sign-in/check-email` | Confirmation after requesting a magic link |
| `/forbidden` | Authenticated but unauthorized; names the missing permission |
| `/verify/[token]` | Public certificate verification — **only** when the `publicCertificateVerification` flag is on and the certificate has a token |

---

## Learner

| Route | Permission | Purpose |
|---|---|---|
| `/home` | authenticated | Learner dashboard; first-login onboarding experience for new hires |
| `/my-training` | authenticated | Assignments grouped by urgency, each with the reason it was assigned |
| `/catalog` | `training.view` | Searchable course catalog with self-enrollment where allowed |
| `/courses/[id]` | `training.view` | Course overview, outline, prerequisites, progress |
| `/courses/[id]/lessons/[lessonId]` | `training.view` | The lesson player (one player per lesson type) |
| `/paths` · `/paths/[id]` | authenticated | Learning paths as a timeline with milestones |
| `/sops` · `/sops/[id]` | `sop.view` | SOP library and reader |
| `/sops/[id]/versions` | `sop.view` | Version history and block-level comparison |
| `/certificates` | authenticated | Earned certificates with PDF download |
| `/transcript` | authenticated | Full chronological training transcript |
| `/skills` · `/skills/[id]` | `skills.view` | Skills library and personal proficiency |
| `/people` · `/people/[id]` | `people.view` | Directory and profiles (sensitive fields separately gated) |
| `/calendar` | authenticated | Due dates, live sessions, expirations, review deadlines |
| `/ask` | `ai.ask` | Ask FSW AI, with clickable citations |
| `/favorites` | authenticated | Saved SOPs, courses, and documents |
| `/notifications` | authenticated | Full notification list |
| `/settings/notifications` | authenticated | Per-type in-app and email preferences |
| `/media/[id]` | authenticated | Media detail with captions and transcript |
| `/help` | authenticated | Getting started, how to find things, keyboard shortcuts |

---

## Manager

| Route | Permission | Purpose |
|---|---|---|
| `/team` | `team.view` | Team dashboard: completion, overdue, onboarding, gaps, expiring |
| `/team/status` | `team.view` | Per-person training status with CSV export |
| `/team/assignments` | `team.assign` or `training.assign` | Assign training to reports |
| `/team/skills` | `team.view` + `skills.view` | Team skills matrix and gaps |
| `/team/approvals` | `team.approve` or `content.review` | Pending sign-offs and practical assessments |
| `/reports` | `reports.view` | Report catalog |

---

## Administration

### Content

| Route | Permission | Purpose |
|---|---|---|
| `/admin/sops` | `sop.create` | SOP management with status, owner, and health score |
| `/admin/sops/new` · `/admin/sops/[id]/edit` | `sop.create` | Block editor with the FSW SOP template |
| `/admin/sops/review` | `sop.create` | Review dashboard: due, overdue, unowned, never reviewed, frequently reported |
| `/admin/sops/[id]/impact` | `sop.approve` | Change impact analysis and the retraining decision |
| `/admin/training` | `training.create` | Course management with completion rate and health |
| `/admin/training/new` · `/admin/training/[id]/edit` | `training.create` | Visual course builder and question editor |
| `/admin/paths` · `/admin/paths/new` · `/admin/paths/[id]/edit` | `path.create` | Learning path builder with relative due dates |
| `/admin/content` | `training.create` or `sop.create` | Content health: most/least viewed, lowest rated, most failed, broken links |
| `/admin/media` | `media.view` | Media library with usage counts and in-use deletion protection |

### AI

| Route | Permission | Purpose |
|---|---|---|
| `/admin/ai-studio` | `ai.generate` | Build with AI hub |
| `/admin/ai-studio/sop` | `ai.generate` | Draft an SOP from a prompt, notes, or a transcript |
| `/admin/ai-studio/course` | `ai.generate` | Course outline → author edits → full generation |
| `/admin/ai-studio/quiz` | `ai.generate` | Generate question drafts from any source |
| `/admin/ai-studio/translate` | `ai.generate` | Translate content, tracked against the source version |
| `/admin/ai-studio/quality` | `ai.generate` | Clarity, ambiguity, reading level, duplicates, broken links |
| `/admin/video-studio` | `ai.video` | Render jobs with live status and retry |
| `/admin/video-studio/new` | `ai.video` | Source → mode → options → editable plan → render |
| `/admin/video-studio/[id]` | `ai.video` | Job detail, preview, publish, staleness warning |

### People and organization

| Route | Permission | Purpose |
|---|---|---|
| `/admin/people` | `people.edit` | People table with bulk actions |
| `/admin/people/new` · `/admin/people/[id]/edit` | `people.edit` | Create and edit; roles and sensitive fields |
| `/admin/people/import` | `people.import` | CSV import with mapping, validation preview, and a rejected-rows file |
| `/admin/organization` | `org.manage` | Business units, departments, teams, locations, positions |
| `/admin/organization/chart` | `org.view` | Interactive org chart |
| `/admin/organization/positions/[id]` | `org.manage` | Position profile with required training and skills |
| `/admin/skills` | `skills.manage` | Skills library, proficiency scale, position requirements |

### Compliance and reporting

| Route | Permission | Purpose |
|---|---|---|
| `/admin/compliance` | `compliance.view` | Compliance Center with the advisor disclaimer |
| `/admin/compliance/matrix` | `compliance.view` | Training requirements matrix with CSV export |
| `/admin/reports` | `reports.view` | Report catalog |
| `/admin/reports/[key]` | per report | One runner serving all 24 reports, with CSV/XLSX/PDF export |
| `/admin` | `reports.view` or `settings.view` | Admin dashboard |
| `/admin/audit` | `audit.view` | Audit log search and filter |

### Platform

| Route | Permission | Purpose |
|---|---|---|
| `/admin/settings` | `settings.view` | Settings hub |
| `/admin/settings/brand` | `settings.manage` | Company name, **application name**, logos, colors |
| `/admin/settings/organization` | `settings.manage` | Organization defaults |
| `/admin/settings/roles` | `settings.manage` | Roles × permissions grid |
| `/admin/settings/training` | `settings.manage` | Due dates, passing scores, watch percentage |
| `/admin/settings/content-review` | `settings.manage` | Review cycle defaults |
| `/admin/settings/compliance` | `settings.manage` | Compliance defaults |
| `/admin/settings/ai` | `settings.manage` | AI provider status |
| `/admin/settings/video` | `settings.manage` | Video defaults and branding |
| `/admin/settings/authentication` | `settings.manage` | Provider status and session policy |
| `/admin/settings/notifications` | `settings.manage` | Reminder cadence and channels |
| `/admin/settings/privacy` | `settings.manage` | Retention periods and privacy notices |
| `/admin/settings/languages` | `settings.manage` | Enabled languages |
| `/admin/settings/features` | `settings.manage` | Feature flags |
| `/admin/integrations` | `integrations.manage` | Capability status, API keys, webhooks |
| `/admin/announcements` · `/new` · `/[id]` | `announcements.manage` | Announcements with targeting and acknowledgement |

---

## API

### Internal (session-authenticated)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | Auth.js handlers |
| `/api/search` | GET | Global search, permission-filtered |
| `/api/progress` | POST | Video and checklist progress (monotonic, anti-scrub) |
| `/api/notifications` | GET | Notification list |
| `/api/notifications/[id]/read` | POST | Mark one read |
| `/api/notifications/read-all` | POST | Mark all read |
| `/api/media/[id]` | GET | Authorized media streaming with Range support |
| `/api/media/upload` | POST | Upload with extension + magic-byte validation |
| `/api/media/scorm/[id]/[...path]` | GET | Sandboxed SCORM content (`allow-scripts`, no `allow-same-origin`) |
| `/api/media/scorm/progress` | POST | SCORM progress bridge |
| `/api/certificates/[id]/pdf` | GET | Certificate PDF (owner or authorized viewer) |
| `/api/certificates/verify/[token]` | GET | Verification lookup |
| `/api/ai/ask` | POST | Streaming Ask FSW AI |
| `/api/ai/coach` | POST | In-course Training Coach |
| `/api/webhooks/test` | POST | Test a webhook delivery |

### Public REST API (API-key authenticated)

Bearer token in `Authorization`. Keys carry scoped permissions; every call is
rate-limited and audited.

| Endpoint | Purpose |
|---|---|
| `/api/v1/openapi` | OpenAPI 3.1 document |
| `/api/v1/people` · `/[id]` | People |
| `/api/v1/courses` · `/[id]` | Courses |
| `/api/v1/sops` · `/[id]` | SOP metadata |
| `/api/v1/assignments` · `/[id]` | Training assignments |
| `/api/v1/completions` · `/[id]` | Completion records |
| `/api/v1/skills` · `/[id]` | Skills |
| `/api/v1/certifications` · `/[id]` | Certificates |
