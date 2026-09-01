# Administrator Guide — FSW People

For HR administrators and system administrators running FSW People day to day.

---

## Contents

- [Roles: who can see what](#roles-who-can-see-what)
- [Users and accounts](#users-and-accounts)
- [Adding people](#adding-people)
- [Onboarding](#onboarding)
- [Contractors and international workers](#contractors-and-international-workers)
- [Time off](#time-off)
- [Time tracking](#time-tracking)
- [Recruiting](#recruiting)
- [Posting jobs to Indeed](#posting-jobs-to-indeed)
- [AI-suggested interview questions](#ai-suggested-interview-questions)
- [Referrals and the talent pool](#referrals-and-the-talent-pool)
- [Skills and certifications](#skills-and-certifications)
- [Shift scheduling and overtime](#shift-scheduling-and-overtime)
- [Time clock kiosks](#time-clock-kiosks)
- [Compensation cycles and pay equity](#compensation-cycles-and-pay-equity)
- [Workforce analytics](#workforce-analytics)
- [The HR assistant](#the-hr-assistant)
- [Access profiles and the exception report](#access-profiles-and-the-exception-report)
- [API keys and webhooks](#api-keys-and-webhooks)
- [Certified e-signature](#certified-e-signature)
- [Storing documents in SharePoint](#storing-documents-in-sharepoint)
- [Performance](#performance)
- [Compensation and benefits](#compensation-and-benefits)
- [Payroll hub](#payroll-hub)
- [Documents and policies](#documents-and-policies)
- [Training, equipment and access](#training-equipment-and-access)
- [Offboarding](#offboarding)
- [Workflows](#workflows)
- [Compliance and retention](#compliance-and-retention)
- [Reports and exports](#reports-and-exports)
- [Importing data](#importing-data)
- [Integrations](#integrations)
- [Audit log](#audit-log)

---

## Roles: who can see what

Ten roles ship with the system. A person can hold several — a Head of People typically holds
HR Admin *and* Manager.

| Role | Can do | Deliberately cannot |
|---|---|---|
| **Super Admin** | Everything, including system settings and user administration | — |
| **HR Admin** | All people management, compensation, documents, compliance, reports | Infrastructure settings, user/role administration |
| **Executive** | Workforce visibility, compensation reads, executive dashboard, approvals | Edit people, run HR operations |
| **Manager** | Their direct and indirect reports: PTO and timesheet approval, reviews, goals, 1:1s | See reports' pay, SSN, date of birth, home address or HR cases |
| **Employee** | Self-service: own profile, PTO, documents, goals, reviews, training, policies | See anyone else's restricted data |
| **Contractor** | Restricted self-service appropriate to a contractor | Employee-only screens |
| **Payroll / Finance** | Compensation, benefits administration, payroll hub, financial reports | HR cases, PII reveal |
| **Recruiter** | Jobs, candidates, interviews, offers | Compensation of existing staff, HR records |
| **IT Administrator** | Equipment and application access | Any HR, medical, compensation or PII data |
| **Auditor** | Read-only across people and the audit log | Change anything, export |

**The manager boundary is enforced on the server.** A manager opening a report's profile
sees title, work contact, PTO, goals and performance — the compensation and personal-data
sections are simply not sent to their browser.

Adjust any role in **Settings → Permissions**. Super Admin cannot be narrowed, and the
system refuses to remove the last Super Admin.

### Narrowing a role by region

`RolePermission.scope` supports limiting a grant to specific legal entities, departments or
countries — for example a Philippines HR administrator who manages only PH workers. Set
this in the database or extend the Permissions screen; the enforcement is already in place
(`scopedWorkerFilter`).

---

## Users and accounts

**Settings → Users & roles.**

- **Invite**: a worker with a work email but no account shows under "Workers without
  accounts" — one click creates the account and sends an activation email.
- **Activation**: the invitee sets their own password. Administrators never see or set it.
- **MFA**: each person enables TOTP under Account → Security. Require it for anyone holding
  HR Admin, Finance, Super Admin or `pii.reveal`.
- **Suspend**: immediately revokes every session. Use this first in any incident.
- **Roles**: multi-select; changes are audited with before and after values.

If email is not yet configured, activation links are still generated — read them in
**Admin → Email Outbox** and send them manually.

---

## Adding people

**People → Directory → Add worker.**

The form adapts to what you choose. Selecting Philippines drops the US-only fields (FLSA,
work state); selecting Contractor adds the engagement model and skips employee-only fields.

**Worker type is a decision you make, not one the system infers.** FSW People will never
reclassify a contractor as an employee based on how they work — that is a legal
determination for HR and counsel.

On save the system creates the worker with an effective-dated employment and compensation
record, sends the activation email, starts the matching onboarding checklist, writes the
timeline event, and fires any `WORKER_ADDED` workflows.

### Changing someone's job or pay

Use **Record job change** (Job tab) and **Record compensation change** (Compensation tab)
rather than editing fields. Both ask for an effective date and a reason, close the current
record, and open a new one — so the history stays readable. Compensation changes can also
be routed for executive approval from the Compensation module.

---

## Onboarding

**Operations → Onboarding** shows every checklist in flight with completion progress.

Templates live in **Operations → Onboarding → Manage templates**. Each template targets a
population (country, worker type, department), and each item within it can narrow further.
That is how one US employee template and one Philippines contractor template produce
genuinely different checklists from the same engine.

Each item has an owner kind (HR, Employee, Manager, IT, Finance), a due offset in days
relative to the start date (negative means before day one), a category, and an optional
dependency on an earlier item.

The shipped US template covers: offer letter, profile creation, employee information,
Form I-9 Section 1 and Section 2, W-4 and PA withholding, handbook acknowledgment, account
provisioning, equipment, first-day welcome, required training, and 30/60/90-day check-ins.

### On Form I-9

FSW People provides **I-9 tracking and document management**: deadlines, Section 1 and
Section 2 status, reverification reminders, retention calculation and an audit trail.

It is **not** a certified electronic I-9 completion system. Producing a legally compliant
electronic I-9 with electronic signature carries additional technical and legal requirements
beyond typing information into a form. Complete I-9s per USCIS instructions and use FSW
People to track and store them, or integrate a specialist provider — the architecture
supports that.

---

## Contractors and international workers

**People → Contractors** lists every contractor engagement with contract dates, rates, tax
form status and expiry warnings.

The contractor tab on a profile records: individual vs business entity, DBA, contract start
and end, payment terms and method, W-9 status (US persons) or W-8 status (foreign persons),
1099 eligibility, and payment records.

**Philippines workers are first-class, not awkward US records.** They get PHP compensation,
Asia/Manila timezone, the Philippine holiday calendar, PH-specific onboarding, and optional
restricted fields for TIN, SSS, PhilHealth, Pag-IBIG and passport — all encrypted, all
optional, and never presented as mandatory for contractors.

Their data is treated as sensitive personal information: minimal collection, limited access,
a privacy notice acknowledgment step in onboarding, and a compliance rule citing the
National Privacy Commission.

**The system does not decide which tax form somebody needs.** W-9 and W-8BEN tracking is
configurable, and `RequiredDocumentRule` lets HR and accounting define what each worker type
owes. Confirm with your tax advisor.

---

## Time off

**Settings → PTO policies** defines policies with a leave type, country, accrual method
(annual grant, front-load, monthly, per-pay-period, or none), hours per year, carryover cap,
maximum balance, waiting period, negative-balance allowance and approval requirement.

Assign a policy to everyone in a country, or to one person at a time.

Balances are always computed from the transaction ledger, so they cannot drift. Accruals run
in the daily sweep and are idempotent — running it twice never double-grants.

Employees request from **Time → Time Off**; hours default to working days minus company
holidays on their country's calendar. Managers approve under the Approvals tab. Approval
writes the negative usage transaction; cancelling an approved request writes a compensating
entry rather than deleting history.

HR can adjust a balance manually from the Balances tab — a reason is required and the
adjustment is audited.

---

## Time tracking

**Time → Timesheets.** Optional per worker: clock in/out, or manual entries with project
codes. Weekly timesheets are submitted by the employee and approved by their manager.
Overtime past 40 hours raises a **warning**, not a determination — FSW People does not
decide overtime eligibility. Configure the rule with your payroll provider and treat the
warning as a prompt.

Corrections are tracked with who made them.

---

## Recruiting

**Recruiting → Jobs** holds requisitions. Draft → send for executive approval → open → on
hold / filled / closed.

Open a job to see its pipeline as a Kanban board. Add candidates, move them between stages,
schedule interviews (which creates a scorecard for each interviewer), and create offers.

Offers route through HR approval before they can be sent. When you record an offer as
accepted, the candidate becomes a worker with their compensation and start date carried
across, and onboarding starts — no re-entry.

**Rejection is always a human decision** and requires a recorded reason. If AI candidate
tools are enabled they may summarize resumes, extract experience, compare against explicit
job requirements and draft questions — they may never autonomously reject anyone, and never
score protected characteristics.

---

## Posting jobs to Indeed

### How it works

Indeed does not have a "create job" API you can call. It sources jobs by crawling an XML
feed you host. FSW People hosts that feed at `/api/indeed/feed`, protected by a long random
token that only Indeed is given.

So "Publish to Indeed" means **the job is now in the feed**. Indeed decides when it crawls,
indexes and ranks the listing — usually within a few hours. The job page shows when Indeed
last fetched the feed, which is the only honest evidence available that the listing is live.
Nothing in FSW People claims a job is on Indeed the instant you click.

### One-time setup (administrator)

1. Generate two secrets and put them in the environment:
   ```
   INDEED_FEED_TOKEN=$(openssl rand -hex 32)
   INDEED_APPLY_SECRET=$(openssl rand -hex 32)
   ```
2. Restart the app.
3. Go to **Admin → Integrations → Indeed**, click **Reveal feed URL** (the reveal is
   audited) and give that URL to Indeed as your XML feed source.
4. If Indeed has enabled Indeed Apply on your account, give them the webhook URL shown on
   the same page and set `INDEED_APPLY_API_TOKEN` to the publisher token they issue. Only
   when both that token and `INDEED_APPLY_SECRET` are set does the feed advertise
   apply-inside-Indeed — a half-configured Apply button would fail for applicants.

The feed URL contains the token. Anyone holding it can read every published job, so treat
it like a password and rotate it by changing the environment variable.

### Publishing a role

On a job's pipeline page, **Job boards → Publish to Indeed**. The job must be **Open** and
must have a description; the control tells you which is missing. You choose:

- **Public job title** and **public location** — what applicants see, if different from the
  internal requisition.
- **Work arrangement** — on-site, hybrid or fully remote.
- **Show the salary range** — off by default. Several states require a pay range in the
  posting; check with HR before leaving it off.

Everything else on the requisition stays internal. Hiring manager, recruiter, headcount,
replacement flag and approval history are never in the feed.

**Removing a role** takes it out of the feed immediately; Indeed clears the public listing
on its next crawl, so it can stay visible on Indeed for a short while afterwards. Closing
or filling the requisition removes it from the feed automatically — you do not have to
remember to unpublish.

### Where candidates arrive

Indeed Apply posts each application to `/api/indeed/apply`. FSW People verifies the
signature, creates or matches the candidate on email, files the application in the first
pipeline stage, stores the résumé, and notifies the recruiter and hiring manager. The
candidate shows a source of "Indeed".

Redeliveries are safe: each Indeed application id is stored once, enforced by a database
constraint, so a retry never creates a duplicate.

**Admin → Integrations → Indeed** shows a delivery log of every exchange — accepted,
duplicate and rejected alike. It records what happened, not a second copy of the
applicant's contact details.

### What FSW People does not do

It does not push hire/reject dispositions back to Indeed. That needs Indeed's partner
Disposition API and credentials FSW Group does not hold. Rejecting a candidate here records
the decision here; nothing is sent to Indeed on your behalf.

### The public careers pages

`/careers` lists every published role and is deliberately public — it is where Indeed sends
applicants who click through. It shows only published postings and only the public fields.
No session, no employee data, no internal pages are reachable from it.

---

## AI-suggested interview questions

On a candidate's page, under an application, **Suggest 5 questions** produces five questions
drawn from that person's experience and that job's description.

### What it is

Preparation help for a human interviewer. Each question comes with why it is worth asking
and what a strong answer contains. That is all it produces.

### What it is not

It carries **no score, no ranking and no hire recommendation**. It cannot advance, reject or
rate anyone. Rejection remains what it has always been: a person, with a written reason.

### What gets sent

Only the candidate's **first name**, their **résumé text with contact details, identifiers,
addresses and links stripped out**, and the **job description and requirements**. No
personnel record, no pipeline history, no interview notes, no scorecards. The redaction is
listed under each generated set so you can see what was removed.

### Guardrails

The model is instructed not to ask about or infer age, race, ethnicity, national origin,
citizenship, disability, health, religion, political belief, union membership, sexual
orientation, gender identity, pregnancy, children, marital or family status, criminal
history, or salary history. Every returned question is then screened for those subjects in
code before it is stored — an instruction is a request, the screen is the enforcement. If
screening leaves fewer than five usable questions, **nothing is saved** and you are asked to
try again.

### Audit trail

Each set records who generated it, which model produced it, and what the model was shown,
and writes an audit event. The panel labels the questions AI-assisted wherever they appear.

### Getting résumé text in

Indeed Apply supplies it automatically. For candidates who arrived as a PDF, use **Résumé
text → Add** on the candidate's Details card and paste it. Without résumé text the generator
still works, but the questions come from the job description alone and say so.

### Setup

Set `ANTHROPIC_API_KEY` (and optionally `AI_MODEL`, which defaults to `claude-opus-5`).
Until then the panel says the feature is not configured rather than offering a button that
would fail.

---

## Referrals and the talent pool

**Recruiting → Referrals** is open to everyone: any employee can refer someone
they know. Referrals close faster and stay longer than any other channel, so
this is the cheapest pipeline available.

An email address is **required**, because a referral is matched to an
application by email exactly — never by name. Two candidates sharing a name
would otherwise mean paying a bonus to the wrong person. If the person has
already applied, the referral attaches immediately; if not, it attaches the
moment they do, whether they come through Indeed or are added by hand.

When a referred candidate is hired, the bonus opens for approval with an
eligibility date 90 days after their start. **FSW People records the decision;
payroll pays it.** Nothing here moves money.

**Recruiting → Talent Pool** holds candidates who interviewed well and lost to
someone stronger. Add them from their profile. Every entry gets a review date —
once it passes they stop appearing as matches and show up for a keep-or-remove
decision, so candidate details are not held indefinitely by default.

Use **Email candidate** on an application to send a status update. A silent
pipeline costs offers, and it is candidates' most common complaint about
employers. Every message is recorded, so "did we ever reply to this person?"
has an answer.

---

## Skills and certifications

**Talent → Skills** tracks what people can actually do, as distinct from what
courses they have taken.

Mark a skill a **certification** if it expires — forklift, OSHA 30, CDL — and
give it a validity period so renewal dates are calculated automatically. Mark
it **critical** if work stops without it. Only critical skills appear as
coverage risk, deliberately, so that the word keeps meaning something.

Coverage counts a person only if they are at Proficient or above, their
certification has not lapsed, and — for critical skills — somebody has
**verified** it. Anyone can record their own skills, which is how the inventory
gets built; verification needs `skills.admin`, because a self-declared
"verified" would be meaningless.

The page then answers the question worth asking: *which critical skills are we
one person deep on?* Certifications lapsing within 60 days appear on the same
page and also raise a workflow event, so a renewal is chased rather than
discovered on the day.

---

## Shift scheduling and overtime

**Time → Schedule** builds a week and publishes it.

Shifts start as **drafts**, invisible to the people working them. Publishing is
one act for the whole week on purpose — a schedule should never be half-changed
in front of the crew. Everyone assigned is notified on publish.

**Overtime is forecast, not discovered.** The projection adds hours already
worked to hours still scheduled and compares against the 40-hour FLSA week, so
unplanned overtime becomes a scheduling decision instead of a payroll surprise.
Assigning someone into overtime is **warned, not blocked** — sometimes it is
the right call. Assigning someone to two overlapping shifts on the same day is
refused outright, because finding that out on the day means a shift goes
uncovered.

**Break rules** live in the database with their jurisdiction and source, like
compliance rules, because they vary by state and they change. The findings list
is a scheduling aid built from rules an administrator recorded — not a legal
opinion. Confirm current requirements with HR or counsel.

**Estimated labour cost** prices scheduled hours at base rates only. It does
not model overtime premium, shift differentials or employer taxes; payroll does
that, and a number that looked complete here would be trusted when it should
not be.

---

## Time clock kiosks

**Admin → Kiosks** registers a shared tablet for the warehouse or a branch.

You get a **one-time setup link**. Open it once on the tablet itself — it
exchanges the token for a device cookie, so it never has to be typed again. The
link is shown once and is not stored.

Workers then clock in with their employee number and a **4-digit PIN**, set on
their own profile under Equipment & Access (they can set their own; HR can set
one for somebody who has forgotten theirs). The PIN is not the account password
and cannot sign anyone in anywhere — it opens the time clock and nothing else.
A kiosk holds no session and can reach no page that shows pay or personal
details.

Punch direction is inferred from state: an open entry means the next punch
closes it. Somebody at 6am should not have to pick the right button. Every
punch is kept as evidence that cannot be edited or deleted, so a disputed hour
is settled from the record.

Revoking a device cuts it off immediately.

---

## Compensation cycles and pay equity

**Compensation → Comp Cycles** replaces the merit spreadsheet.

Create a cycle with an effective date and a budget, then **Add eligible
people** to build the population from the eligibility rules. Each person's
current pay is snapshotted, so a mid-cycle change elsewhere cannot shift the
roll-up under you.

Delegate a budget per manager. Managers propose for **their own reports only** —
that boundary is enforced on the server, not by hiding rows. Drafts count
against the budget as well as submitted proposals, so a manager sees the effect
while typing rather than after sending. Going over budget is shown, not
blocked: the roll-up exists to make the overage visible before it is approved.

A cycle cannot reduce pay or more than double it. Both are real changes that
belong outside a merit cycle with their own approvals.

Move the cycle to review, decide each proposal, then **approve** it — which
requires every submitted proposal to have a decision. **Applying** writes one
effective-dated compensation row per person: the current row is closed the day
before and a new one opened, so history stays intact. Applying is idempotent; a
double click or a retried job cannot pay anyone twice.

**Compensation → Pay Equity** shows pay dispersion within each job family and
level — where a difference nobody can explain would appear. It reports on roles
rather than people, so it can go to a comp committee without disclosing
anybody's pay. It is a place to start looking, **not** a legal pay equity
audit: a defensible audit is run by counsel, controls for legitimate factors,
and is usually privileged.

---

## Workforce analytics

**Insights → Workforce Analytics** shows leading indicators rather than history:
early attrition by hire cohort, hiring velocity, pay position against band, and
retention signals.

**Read the retention signals correctly.** They are named, job-related
conditions the company can act on — pay that has not moved in two years, a
missing 1:1, a manager carrying too many people — and each one carries the
action that would clear it. They are a prompt for a conversation or a pay
review. They are **never a basis for adverse action** and they are not a
prediction about any individual.

No characteristic of a person is used. Age, date of birth, gender, ethnicity,
national origin, citizenship, disability, marital or family status and home
address are never read by this analysis, by construction. Opening the list is
audited.

A hire cohort younger than its own 90-day window reports "too early" rather
than a flattering zero.

---

## The HR assistant

**HR Assistant** in the sidebar answers questions from your handbook and your
own record.

It reads **only** the policies you personally are entitled to see — the same
audience rules that decide what appears on your policy list — plus facts about
you: your leave balance, your manager, your next holiday. It cannot see a
colleague's information at any permission level, and asking about one gets you
pointed at the directory.

Every substantive answer **cites the policy and version** it came from, and the
citation links to it. If your policies do not cover the question, it says so
and offers to send it to HR rather than guessing — a confident wrong answer
about leave or pay is worse than no answer. It never states employment law from
general knowledge.

Sending a question to HR creates a **task**, not a case file. Asking a question
should never leave a disciplinary-shaped record against somebody.

Set `ANTHROPIC_API_KEY` to enable it; until then the panel says so rather than
offering a button that would fail.

---

## Access profiles and the exception report

**App Access → Access Profiles** turns "what does a Warehouse Associate get"
into data instead of tribal knowledge. Give a profile at least one rule — a
profile with no rules applies to nobody, deliberately, so a half-filled one
cannot provision the whole company.

Onboarding raises the grant tasks from the matching profiles. Offboarding
raises revoke tasks from **what was actually granted**, not from what a profile
says they should have had — those two differ, and the difference is exactly
what gets left behind. Both are idempotent, so re-running a lifecycle is safe.

FSW People does not press the button in each vendor console; that needs their
APIs. A task with a named owner plus an evidence record is what someone has to
do anyway, tracked instead of remembered.

**App Access → Exceptions** is the report that makes the loop worth having:

- **Still has access after leaving** — a terminated worker with a live grant,
  ordered oldest first. This is the finding an auditor opens with and the one
  nobody discovers on their own.
- **Missing an expected entitlement** — a profile says they should have it and
  they do not.
- **Access no profile accounts for** — granted individually; confirm it is
  still needed.

Recording that an exception is acceptable adds a reason to the evidence log and
**does not clear it**. An accepted risk should stay visible.

---

## API keys and webhooks

**Admin → API & Webhooks** lets other FSW systems read approved HR data instead
of re-keying it — Prophet 21, Power BI, Pipedrive.

The API is **read-only**. Nothing outside this application changes an HR record
without going through the same authorization and audit path a person does.

Issue one key per consuming system with only the scopes it needs:
`workers.read` for the directory, `org.read` for structure, `headcount.read`
for aggregates. Keeping headcount separate means a dashboard that needs only
totals can never enumerate the directory.

**A key is shown exactly once.** It is stored as a hash, so there is no way to
recover it later — only to revoke it and issue a new one. Give keys an expiry;
a dated key is easier to rotate.

Responses carry a fixed set of fields and nothing else. Date of birth, home
address, personal contact details, compensation and identifiers are absent, and
there is no parameter a caller can use to widen the response.

**Webhooks** push events to another system. Endpoints must be https, and each
delivery is signed with HMAC-SHA256 — verify the signature on your side before
trusting the payload. Payloads carry ids and the event, not personnel data: a
receiver that needs detail calls the read API with its own key. Deliveries are
queued and sent by the maintenance job, retried with backoff, then abandoned
visibly in the delivery log rather than disappearing. An endpoint that fails 20
times running is switched off.

---

## Certified e-signature

There are **two different things** called signing in FSW People, and picking
the wrong one wastes money or leaves you without evidence.

**Internal acknowledgment** — the signer types their full name; FSW People
records it with their IP, browser and a timestamp, bound to that exact document
version, in a table nothing can edit afterwards. Free, instant, and right for
handbook reads, policy acknowledgments and IT usage agreements.

**Certified signature** — the document goes to SignNow, which runs the signing
ceremony and produces a tamper-evident audit certificate. Right for offer
letters, contractor agreements and anything you might later need to defend.

### Sending one

Open a document, then **Certified signatures → Request signature**. The
document must be a PDF. Choose the signer, a due date and an optional message.

The signer gets an email from SignNow and also sees a **Review & sign** button
on the document in FSW People. Only the person being asked can open the signing
session — not their manager, not HR. A signing link that somebody else could
obtain would let them sign in the worker's name.

### Following it

**Documents → Signature Status** shows everything outstanding, with filters and
a nudge. Reminders are limited to one a day, so "remind" cannot become
harassment.

Two statuses are deliberately separate:

- **Signed — storing** means SignNow says it is done but the file is not yet in
  our own storage.
- **Signed & filed** means we hold both the signed PDF and the audit
  certificate ourselves.

Anything stuck between those two shows under **Needs attention**. The nightly
maintenance sweep retries automatically, and there is a manual **Retry
download** button. Until a request reaches "signed & filed", the only copy of
your evidence is at the vendor.

### Why we keep the certificate

At completion FSW People downloads the signed PDF **and** SignNow's audit
certificate, and stores both. If FSW ever leaves SignNow, the proof of who
signed what comes too. The signed PDF becomes a new version of the original
document, so it appears in that document's own history and downloads through
the same audited link as everything else.

### What this does not do

- **It is not legal advice.** Whether an electronic signature is enforceable
  depends on the whole process — consent to transact electronically,
  demonstrable intent, attribution, record retention — not just on using a
  vendor. Confirm your use with counsel.
- **It does not make Form I-9 compliant.** I-9 has its own electronic
  signature and retention requirements that go beyond generic e-signature.
  Treat I-9 as a separate track with a specialist provider.

### Setup

`SIGNNOW_CLIENT_ID`, `SIGNNOW_CLIENT_SECRET`, `SIGNNOW_USERNAME`,
`SIGNNOW_PASSWORD`, and `SIGNNOW_WEBHOOK_SECRET` (`openssl rand -hex 32`).
Register the webhook in SignNow pointing at
`https://your-host/api/esign/signnow`.

**Test against `SIGNNOW_API_BASE="https://api-eval.signnow.com"` first.** A
sandbox key pointed at the production host sends real invites to real people.

Then run `npx tsx scripts/verify-signnow.ts you@yourcompany.com`. It exercises
each call in order and names the exact endpoint to correct if one fails — the
adapter was written from documentation rather than against a live account, so
expect to fix a field name or two on first contact.

---

## Storing documents in SharePoint

Set `STORAGE_DRIVER=graph` and documents live in SharePoint instead of on disk
— which means Purview retention labels, DLP, eDiscovery and Microsoft's backup
all apply to your HR documents.

### The one decision that matters

**The target site must have no human members.** Grant it to the FSW People app
registration with `Sites.Selected` and to nobody else.

SharePoint permissions are a completely separate system from FSW People's
roles. If HR can browse the library directly, then `canAccessDocument()` and
the download audit trail stop being the real access control — anyone with site
access reads disciplinary files and I-9s with no record of having done so.
With an app-owned site, FSW People stays the only door: the download route
still checks the session, the signed link and the document rules, and only then
fetches the bytes.

**Do not point this at a Team's document library.** That is the version that
quietly undoes the authorization model, and it is the obvious thing to do
because it is convenient.

### Setup

1. **Entra ID → App registrations → New registration.** Free; this is not
   Azure hosting and there is no bill.
2. Add a client secret, note it.
3. **API permissions → Microsoft Graph → Application permissions →
   `Sites.Selected`**, then **Grant admin consent**. Admin consent is required
   by design.
4. Create a SharePoint site for HR documents. Remove every member.
5. Grant the app write access to that one site (`Sites.Selected` grants nothing
   until a site is assigned to it — a Graph call or the SharePoint admin
   tooling does this).
6. Set `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`,
   `MS_GRAPH_SITE_ID` and `STORAGE_DRIVER=graph`.
7. Run `npx tsx scripts/verify-sharepoint.ts`. It round-trips a small file and
   a 5 MB file (which exercises the chunked upload path), then reminds you to
   confirm by eye that the site has no members — that part needs a human.

Steps 3 and 5 need a tenant administrator. If an outside IT provider runs your
M365, that ticket is usually where the calendar time goes.

---

## Performance

**Talent → Reviews → Launch cycle** creates self and manager review forms for every active
employee in one step. Employees write their self review; managers write theirs and then
explicitly **share** it — a manager review is not visible to the employee until shared.

The calibration panel shows the rating distribution across submitted manager reviews.

**Goals** support individual, department and company levels with alignment (individual goals
roll up to a company goal), weights, due dates and progress.

**1:1s** carry a shared agenda and shared notes, plus a private notes field for each side.
The manager's private notes are never visible to the report, and vice versa.

**Feedback** is either public recognition, private feedback visible to the person's manager,
or confidential HR documentation.

**People → HR Cases** is the confidential employee-relations area: coaching notes, warnings,
PIPs, investigations, complaints and incidents, with notes, follow-up dates and resolutions.
These never appear on ordinary profiles and require the `cases.read` permission.

---

## Compensation and benefits

**Compensation** lists current pay with salary-band positioning and compa-ratio. Bands are
defined by job family × level × geography in **Salary Bands**.

Compensation changes can be entered directly (HR) or requested with routing to executive
approval, in which case the change applies automatically once approved.

**Benefits** holds plans (medical, dental, vision, life, disability, 401(k), HSA, FSA) with
employee and employer costs and waiting periods. Employees enroll or waive; HR sees total
employer cost across all enrollments.

---

## Payroll hub

**Compensation → Payroll Hub.** Create a period and see everything payroll needs for it:
compensation changes, new hires, terminations, approved PTO, approved hours and contractor
payments. Export to CSV for your provider.

Periods move OPEN → REVIEW → APPROVED → EXPORTED → CLOSED.

**FSW People does not calculate or file payroll taxes.** It prepares the data; Gusto, ADP,
Paychex, QuickBooks Payroll or your chosen provider runs pay and files.

---

## Documents and policies

**Documents** is the HR vault. Categories, four data classifications, versions, expiry
dates and signature requirements.

Downloads use short-lived signed links and are audited. There are no public URLs — a
document link cannot be forwarded to someone without access.

**Legal templates must be version-controlled with a named approver.** The upload form asks
who approved a document and when it takes effect. FSW People never invents legal language.

**Policies** are versioned with acknowledgment tracking. Publishing a new version assigns it
to its audience and preserves the previous version's acknowledgment history — you can always
show what somebody agreed to and when.

Internal acknowledgment and e-signature capture the signatory, authenticated identity,
document version, timestamp, IP and device, as an immutable event. For documents with
specialist statutory e-signature requirements, integrate DocuSign or Adobe Sign.

---

## Training, equipment and access

**Training** holds courses with categories, due windows, recurrence and completion records.
Assign to everyone, to a matching population, or to one person. Overdue training is flagged
in the daily sweep and can escalate to the manager via a workflow.

**Equipment** tracks assets with tags, serials, value and condition through their assignment
lifecycle. Offboarding automatically raises return tasks.

**App Access** is the catalog of who has access to what, with cost per seat and renewal
dates. Onboarding provisions, offboarding revokes. Revoked grants are retained, so "who had
access last March?" stays answerable.

---

## Offboarding

Start from the worker's **Job tab → Start offboarding**: last day, reason, voluntary or not.

This generates the offboarding checklist. Access-removal tasks are created at **CRITICAL**
priority and assigned to the IT queue, and **Operations → Offboarding** surfaces any that are
still open past the last day in a red banner at the top of the page.

On the last day, **Finalize termination** closes the employment record, deactivates the
account, revokes every active application grant, and records rehire eligibility. Employment
history, compensation history and the audit trail are all preserved.

---

## Workflows

**Admin → Workflows.** Build "if this → then that" automations: pick a trigger, optionally
narrow to a population, and add actions.

Triggers include worker added, start date approaching, offer accepted, birthday, anniversary,
title/department/manager changed, PTO submitted or approved, training overdue, document
expiring, contract expiring, review cycle started, termination scheduled, and equipment
unreturned.

Actions include create task, send email, notify a person or role queue, assign training,
assign a policy, request a document, start onboarding or offboarding, and call webhooks.

Eight ready-made templates install with one click. Every evaluation is logged with a
step-by-step result, so you can see exactly what a workflow did and why it skipped.

Scheduled triggers run in the daily sweep — **Run daily sweep now** triggers it manually.

---

## Compliance and retention

**Admin → Compliance.** Rules are **data**, not code. Each carries a jurisdiction, an
authoritative source and URL, applicability, a deadline calculation, severity, a responsible
role and a review date.

Seeded rules cover Form I-9, Form W-4, Pennsylvania withholding, W-9 for US contractors,
W-8BEN for foreign contractors, and the Philippine Data Privacy Act notice — each linked to
its official source.

**Sync compliance items** materializes obligations for every matching worker. High and
critical rules also raise a real task in the responsible role's queue.

**Verify every requirement with HR, legal or your payroll provider.** FSW People surfaces
obligations and tracks evidence; it does not make legal determinations, and it deliberately
does not pretend certainty it does not have.

**Retention** policies are configurable by record type, jurisdiction and anchor. The system
calculates destruction *eligibility* only — actual destruction requires an explicit,
documented approval by a retention administrator, anonymizes restricted personal data, and
preserves employment history so historical reporting stays honest. Every destruction is
audited.

---

## Reports and exports

**Insights → Reports** has reports across workforce, turnover, recruiting, onboarding, PTO,
compensation, compliance, training, international and payroll.

Every report respects your permissions — a manager does not see the compensation report at
all. Exports check both the export permission and the individual report's permission, so the
export endpoint cannot be used to obtain data the UI withholds. Each export writes an audit
event with the report name, row count and filters.

**Insights → Executive Dashboard** gives headcount and its 12-month trend, labor cost,
turnover and regrettable turnover, average tenure, open roles, time to fill, offer
acceptance, onboarding completion, and upcoming hires — with drill-down where permissions
allow.

---

## Importing data

**Admin → Imports.** Upload → validate → preview → confirm.

Nothing is written until you confirm. Every row is validated first (unknown department,
duplicate email, bad date, unknown entity code) and rows with errors are listed with the
specific problem. On import, valid rows are applied and invalid rows are skipped — a bad row
never corrupts the batch. A full per-row report is stored.

Supported: workers, departments, compensation, PTO balances, equipment. Each type lists its
required and optional columns on screen.

---

## Integrations

**Admin → Integrations** catalogs Microsoft (Entra ID SSO, 365, Outlook, Teams), HR vendors
(payroll, benefits, background checks, e-signature) and FSW systems (Prophet 21, Pipedrive,
RingCentral, QuickBooks, BigCommerce, Power BI, Google Drive, Notion).

Credentials are **never** stored in the database — each adapter reads its secrets from
environment variables, and the page shows which are present. FSW People is fully usable
before any integration is connected; each one adds convenience, none is required.

---

## Audit log

**Admin → Audit Log** records sign-ins and failures, permission changes, worker and
compensation changes, PII reveals, document access and signatures, exports, terminations,
retention destruction, workflow changes and maintenance runs.

Filter to high-risk events only, or to the last 24 hours / 7 days / 30 days.

**Audit records cannot be edited or deleted** — a database trigger rejects any attempt, even
using the application's own credentials. Review `pii.reveal`, `export.run` and
`retention.destruction_approved` periodically.
