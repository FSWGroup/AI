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
