# Data Model — FSW People

The authoritative definition is [`prisma/schema.prisma`](prisma/schema.prisma). This
document explains the shape and the reasoning behind the parts that are not obvious.

---

## Core principle: history is never overwritten

Three ideas do most of the work in this schema.

**Effective dating.** `EmploymentRecord` and `Compensation` are append-only in practice: a
change closes the current row by setting `effectiveTo` and inserts a new row. The "current"
record is the one with `effectiveTo IS NULL`. A promotion, transfer, entity change or raise
therefore leaves a readable trail, and "what was true in March?" is a query rather than a
guess.

**Derived balances.** PTO balance is `SUM(PtoTransaction.hours)`. Accruals and grants are
positive, usage is negative, and cancelling an approved request writes a compensating
`ADJUSTMENT` rather than deleting the original. There is no mutable balance column to drift.

**Separation of person, worker and account.** `User` (authentication) is separate from
`Worker` (the HR record). A worker can exist without an account (a new hire before their
work email exists, a contractor who never needs the portal); an account can exist without a
worker (a system administrator). This also means deactivating access does not touch the
employment record.

---

## Entity map

### Organization

```
Organization ─┬─ LegalEntity  (FS Welsford, ValveMan, future subsidiaries)
              │
Department ───── Team
Location
HolidayCalendar ─── Holiday
```

Every worker's `EmploymentRecord` points at a `LegalEntity`, `Department`, `Team` and
`Location`. Because those live on the effective-dated record rather than on `Worker`, a
person can move between entities and departments with full history preserved.

### Identity and access

```
User ─┬─ UserRole ── Role ── RolePermission
      ├─ Session
      ├─ AuthToken       (activation / password reset, hashed, single-use)
      └─ Notification
```

`RolePermission.scope` optionally narrows a grant to specific legal entities, departments or
countries — the basis for regional HR administrators.

### The worker

```
Worker ─┬─ EmploymentRecord*     effective-dated: entity, dept, team, location,
        │                        manager, secondary manager, title, FLSA, work mode
        ├─ Compensation*         effective-dated: amount, currency, rate type, bonus
        ├─ WorkerIdentifier*     ENCRYPTED: SSN, ITIN, PH TIN/SSS/PhilHealth/Pag-IBIG,
        │                        passport — with plaintext last4 only
        ├─ BankAccount*          ENCRYPTED account and routing numbers
        ├─ EmergencyContact*
        ├─ ContractorProfile     business/individual, contract dates, W-9/W-8 status
        ├─ ContractorPayment*
        ├─ TimelineEvent*        with a visibility level per event
        └─ CustomFieldValue*     admin-defined fields, no migration needed
```

`Worker.workerType` (`EMPLOYEE` / `CONTRACTOR` / `EOR` / `AGENCY`) is an explicit
HR-controlled field. Nothing in the system ever infers or changes it from how somebody
works — a deliberate design constraint, because worker classification is a legal
determination.

`TimelineEvent.visibility` (`SELF` / `MANAGER` / `HR` / `COMP` / `HR_CONFIDENTIAL`) is
evaluated per viewer, so a compensation change and an HR case appear on the same timeline
but only to people entitled to see them.

### Recruiting

```
JobRequisition ─┬─ Application ─┬─ Interview ── InterviewScorecard
                │   │           ├─ Offer
                │   │           └─ InterviewQuestionSet   (AI-suggested, advisory)
                │  Candidate ───┘
                └─ JobBoardPosting                        (per board: INDEED)
JobBoardDelivery  (append-only log of every exchange with a board)
PipelineStage (ordered, customizable)
```

An accepted `Offer` calls the same `createWorker()` used by HR's "Add worker", so a hire
carries its compensation and start date across without re-entry, and immediately gets the
onboarding checklist matching its population.

`JobBoardPosting` is the publish record for one requisition on one board — unique on
`(requisitionId, board)`. It holds only what differs from the internal requisition for a
public audience: the public title and location, the work arrangement, and whether the salary
range may be shown (off by default). A posting is only in the feed while its requisition is
`OPEN`, so closing a job unpublishes it without anyone remembering to.

`Application.sourceRef` is the board's own application id, stored **unique**. That
constraint — not application logic — is what makes an Indeed webhook retry incapable of
creating a duplicate application. `Candidate.resumeText` holds the plain-text résumé, from
Indeed Apply or pasted by a recruiter; it is what the AI question generator reads.

`JobBoardDelivery` is evidence, not data: every inbound delivery and every outbound feed
fetch, including deliveries we refuse. It carries the same append-only trigger as
`AuditEvent` and stores a digest (which job, which fields were present) rather than a second
copy of the applicant's contact details.

`InterviewQuestionSet` stores the five generated questions with the model that produced them
and a `basis` recording what that model was actually shown — including which categories of
personal data were redacted first. Advisory only: nothing in this table can advance, rate or
reject a candidate.

### Lifecycle and tasks

```
LifecycleTemplate ── LifecycleTemplateItem
        │              (owner kind, due offset, category, row-level conditions)
        └── LifecycleInstance ── Task ─┬─ TaskComment
                                       └─ Task (dependsOn)
```

Templates carry `conditions` (country, worker type, department, work state, work mode) at
both template and item level, so one US employee template and one Philippines contractor
template produce genuinely different checklists. `Task` is the universal work item — every
module feeds it, and `/tasks` is the single queue.

### Time

```
PtoPolicy ─┬─ PtoPolicyAssignment ── Worker
           ├─ PtoTransaction        (the ledger: ACCRUAL/GRANT/USAGE/ADJUSTMENT/
           │                         CARRYOVER/EXPIRY)
           └─ PtoRequest ───────────┘
Timesheet ── TimeEntry
```

Accrual keys are stored in `PtoTransaction.note` (e.g. `accrual:2026-09`), which is what
makes the daily sweep idempotent — running it twice cannot double-grant.

### Talent

```
ReviewCycle ── PerformanceReview   (SELF / MANAGER / PEER / UPWARD forms)
Goal (self-referencing for alignment: individual → department → company)
OneOnOne     (sharedNotes + managerNotes + reportNotes, each visible to one side)
Feedback     (PRAISE / FEEDBACK / PRIVATE_HR, with a visibility level)
HrCase ── HrCaseNote   (confidential; never surfaced on ordinary profiles)
```

### Compensation, benefits, payroll

```
SalaryBand          (job family × level × geography → min/mid/max)
BenefitPlan ── BenefitEnrollment
PayrollPeriod       (OPEN → REVIEW → APPROVED → EXPORTED → CLOSED)
```

FSW People prepares payroll data; it does not calculate or file payroll taxes. The payroll
change report aggregates comp changes, hires, terminations, approved PTO, approved hours and
contractor payments for a period, for export to the payroll provider.

### Documents and policies

```
Document ── DocumentVersion ── DocumentSignature   (immutable, version-bound)
Policy   ── PolicyVersion   ── PolicyAcknowledgment
```

Signatures and acknowledgments always reference a **specific version**. Publishing a new
version of the handbook cannot retroactively change what somebody agreed to, and the prior
version's acknowledgment history stays intact.

### Operations

```
EquipmentAsset ── EquipmentAssignment    (assigned → returned, with condition)
SoftwareApp    ── AppAccessGrant         (granted → revoked, never deleted)
TrainingCourse ── TrainingAssignment     (with recurrence and expiry)
Survey         ── SurveyResponse         (anonymous responses keyed by one-way hash)
Announcement   ── AnnouncementAck
```

`AppAccessGrant` keeps revoked rows so "who had access to Prophet 21 last March?" remains
answerable — important for both offboarding verification and audits.

### Automation and governance

```
WorkflowDefinition ── WorkflowRun     (trigger + conditions + actions, all JSON)
ApprovalRequest    ── ApprovalStep    (sequential; decisions immutable)
ComplianceRule     ── ComplianceItem  (jurisdiction, source URL, review date)
RetentionPolicy
AuditEvent                            (append-only, DB-enforced)
CustomFieldDef     ── CustomFieldValue
Integration, WebhookEndpoint, EmailMessage, ImportJob, ReportDefinition
```

Workflow actions and conditions are JSON so a new action type needs no migration.
Compliance rules are data for the same reason — laws change more often than schemas should.

---

## Data integrity constraints

Enforced in the database, not merely in application code:

| Rule | How |
|---|---|
| Employee numbers are unique | `Worker.employeeNumber @unique`, plus collision-retry in `createWorker` |
| Work emails are unique | `Worker.workEmail @unique`, `User.email @unique` |
| Manager relationships cannot form a cycle | `fsw_check_manager_cycle()` trigger on `EmploymentRecord` |
| Audit events cannot be altered | `fsw_prevent_mutation()` trigger on `AuditEvent` |
| Signatures cannot be altered | Same trigger on `DocumentSignature` |
| One signature per person per document version | `@@unique([documentVersionId, workerId, kind])` |
| One acknowledgment per person per policy version | `@@unique([policyVersionId, workerId])` |
| One survey response per person | `@@unique([surveyId, respondentKey])` |
| One approval decision per step | `@@unique([requestId, order])` + service-layer immutability |
| One timesheet per worker per week | `@@unique([workerId, weekStart])` |
| Document versions are sequential | `@@unique([documentId, version])` |

Multi-record operations (worker creation, job change, compensation change, PTO approval,
termination) run inside `db.$transaction` so a partial failure leaves nothing half-applied.

---

## Soft deletion vs retention

`Worker.deletedAt` and `Document.deletedAt` hide records from ordinary views. This is
**not** the retention mechanism — soft deletion is a UI concern. Actual destruction runs
through `RetentionPolicy` and requires an explicit, audited approval by a `retention.admin`,
which anonymizes restricted personal data while preserving employment history. The two
concepts are deliberately kept apart.

## Added in the improvement pass

```
Skill ── WorkerSkill ── Worker            certification expiry, verification, coverage
      └─ JobSkillRequirement ── JobRequisition

CompCycle ─┬─ CompCycleBudget (per manager)
           └─ CompProposal ── Worker      → one effective-dated Compensation row on apply

Referral ── Worker (referrer) ── Candidate    matched by email, exactly
TalentPoolEntry ── Candidate                  every entry carries a review date

ShiftTemplate ── Shift ── ShiftAssignment ── Worker
BreakRule                                     jurisdictional, with source URLs

KioskDevice ── KioskPunch ── Worker           append-only; Worker.kioskPinHash
AuthToken(MAGIC_LINK)                         single-use, 15 minutes

AccessProfile ── AccessProfileItem ── SoftwareApp
AccessEvent ── Worker                         append-only provisioning evidence

ApiKey                                        hashed, scoped, rate limited
WebhookEndpoint ── WebhookDelivery            HMAC-signed, retried with backoff
```

Three of these carry the same append-only database trigger as `AuditEvent`, because each
is evidence somebody may later dispute: `KioskPunch` (a contested hour), `AccessEvent`
(whether access was really removed) and `JobBoardDelivery` (whether a candidate was really
sent to us).

`CompProposal.currentAmount` is a **snapshot** taken when the cycle is populated, so a pay
change made elsewhere mid-cycle cannot silently shift the budget roll-up. `appliedAt` is
what makes applying idempotent — a proposal already stamped is skipped even if somebody
resets its status.

`WorkerSkill.verifiedAt` is what separates a claim from a fact. Critical skills only count
toward coverage once a named person has verified them, which is why self-recording a skill
is open to everyone and marking one verified is not.
