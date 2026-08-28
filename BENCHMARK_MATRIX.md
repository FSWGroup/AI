# Benchmark Matrix — FSW People

An honest assessment of FSW People against the functionality commonly associated with
category-leading HR platforms.

**Method.** Benchmark columns describe capabilities those categories of product are
generally known for publicly — they are not copies of any vendor's feature list, and no
proprietary content or code was used. The purpose is to find gaps worth closing, not to
claim parity.

**Legend:** ✅ implemented and working · ◐ partial, with the limit stated · ○ architected but
needs an external provider or credential · ✗ not built

---

## Core HR / system of record

| Capability | FSW People | Rippling-style | BambooHR-style | Gusto-style | Deel-style | Notes |
|---|---|---|---|---|---|---|
| Employee directory with search and filters | ✅ | ✅ | ✅ | ✅ | ✅ | Server-side search, filter, pagination |
| Rich worker profile with tabs | ✅ | ✅ | ✅ | ✅ | ✅ | Nine tabs, each permission-gated |
| Multi-entity / multi-company | ✅ | ✅ | ◐ | ◐ | ✅ | FSW Group + FS Welsford + ValveMan; adding entities needs no redesign |
| Effective-dated employment history | ✅ | ✅ | ✅ | ◐ | ✅ | Never overwritten |
| Org chart | ✅ | ✅ | ✅ | ◐ | ✅ | Expand/collapse, search, zoom, dotted-line, headcount, print |
| Employee timeline | ✅ | ✅ | ✅ | ◐ | ◐ | Per-event visibility levels |
| Custom fields without migration | ✅ | ✅ | ✅ | ◐ | ◐ | Nine field types with per-field visibility |
| Field-level permissions | ✅ | ✅ | ◐ | ◐ | ◐ | Enforced server-side, asserted by test |
| Worker classification as an explicit field | ✅ | ✅ | ✅ | ✅ | ✅ | Never auto-derived |
| Global search across modules | ✅ | ✅ | ◐ | ◐ | ◐ | Permission-filtered per result type |

## Onboarding and offboarding

| Capability | FSW People | Rippling-style | BambooHR-style | Gusto-style | Deel-style | Notes |
|---|---|---|---|---|---|---|
| Template-driven onboarding by population | ✅ | ✅ | ◐ | ◐ | ✅ | Country, worker type, department, state, work mode |
| Task owners, due offsets, dependencies | ✅ | ✅ | ◐ | ◐ | ◐ | |
| 30/60/90-day check-ins | ✅ | ✅ | ✅ | ◐ | ◐ | Seeded in the US template |
| I-9 tracking and retention | ◐ | ✅ | ✅ | ✅ | n/a | **Tracking and document management only** — see limitations |
| W-4 and state withholding tracking | ◐ | ✅ | ✅ | ✅ | n/a | Tracked as documents/compliance items, not filed |
| Offboarding with access revocation | ✅ | ✅ | ◐ | ◐ | ✅ | CRITICAL IT tasks, surfaced prominently past the last day |
| Automatic account provisioning | ○ | ✅ | ✗ | ✗ | ◐ | Tasks are generated; automated provisioning needs the Entra ID integration |
| Equipment issue and return | ✅ | ✅ | ◐ | ✗ | ✅ | Tied into on/offboarding |

## Time

| Capability | FSW People | Rippling-style | BambooHR-style | Gusto-style | Deel-style | Notes |
|---|---|---|---|---|---|---|
| Accrual engine with caps and waiting periods | ✅ | ✅ | ✅ | ✅ | ◐ | Five accrual methods; balances derived from the ledger |
| Request and approval flow | ✅ | ✅ | ✅ | ✅ | ✅ | Working-day math minus country holidays |
| Multi-country holiday calendars | ✅ | ✅ | ◐ | ◐ | ✅ | US and Philippines seeded |
| Team calendar / who's out | ✅ | ✅ | ✅ | ◐ | ◐ | Month grid with PTO, holidays and birthdays |
| Clock in/out and timesheets | ✅ | ✅ | ◐ | ✅ | ◐ | With manager approval and correction tracking |
| Overtime handling | ◐ | ✅ | ◐ | ✅ | ◐ | Configurable **warnings**, not legal determinations |
| Scheduling / shift management | ✗ | ✅ | ✗ | ◐ | ✗ | Not built |

## Recruiting

| Capability | FSW People | Rippling-style | BambooHR-style | Gusto-style | Deel-style | Notes |
|---|---|---|---|---|---|---|
| Requisitions with approval | ✅ | ✅ | ✅ | ◐ | ◐ | |
| Kanban pipeline with custom stages | ✅ | ✅ | ✅ | ◐ | ◐ | |
| Interview scheduling and scorecards | ✅ | ✅ | ✅ | ✗ | ◐ | Calendar sync needs the Microsoft integration |
| Offers with approval and send | ✅ | ✅ | ✅ | ◐ | ✅ | |
| Candidate → employee with no re-entry | ✅ | ✅ | ✅ | ◐ | ✅ | Carries comp and start date, starts onboarding |
| Careers site / job board posting | ✅ | ◐ | ✅ | ✗ | ✗ | Public `/careers` pages + Indeed XML feed |
| Indeed posting | ✅ | ◐ | ✅ | ✗ | ✗ | Token-protected feed Indeed crawls; publish per job |
| Applications delivered into the pipeline | ✅ | ◐ | ✅ | ✗ | ✗ | Indeed Apply webhook, HMAC-verified, idempotent |
| Disposition sync back to the board | ✗ | ◐ | ◐ | ✗ | ✗ | Needs Indeed's partner API — documented, not faked |
| AI interview question preparation | ✅ | ◐ | ✗ | ✗ | ✗ | Five per application, screened for protected characteristics, advisory only |
| Resume parsing | ◐ | ◐ | ✅ | ✗ | ✗ | Structured résumé text from Indeed Apply or pasted; PDF text extraction needs a provider |

## Talent

| Capability | FSW People | Rippling-style | BambooHR-style | Gusto-style | Deel-style | Notes |
|---|---|---|---|---|---|---|
| Goals with alignment and weights | ✅ | ✅ | ◐ | ✗ | ◐ | Individual → department → company |
| Review cycles (self + manager) | ✅ | ✅ | ✅ | ◐ | ◐ | One-click launch across the org |
| Peer / 360 reviews | ◐ | ✅ | ✅ | ✗ | ✗ | Data model supports PEER/UPWARD; UI covers self and manager |
| 1:1s with private notes per side | ✅ | ◐ | ✗ | ✗ | ✗ | |
| Feedback and recognition | ✅ | ✅ | ◐ | ✗ | ✗ | Three visibility levels |
| Calibration | ◐ | ✅ | ◐ | ✗ | ✗ | Rating distribution; no 9-box grid or succession UI |
| Confidential HR cases | ✅ | ◐ | ✅ | ✗ | ✗ | Warnings, PIPs, investigations |
| Engagement surveys with anonymity floor | ✅ | ◐ | ✅ | ✗ | ✗ | Hash-keyed responses, minimum-response threshold |

## Compensation, benefits, payroll

| Capability | FSW People | Rippling-style | BambooHR-style | Gusto-style | Deel-style | Notes |
|---|---|---|---|---|---|---|
| Effective-dated compensation history | ✅ | ✅ | ✅ | ✅ | ✅ | |
| Salary bands with compa-ratio | ✅ | ✅ | ◐ | ✗ | ◐ | |
| Compensation change approvals | ✅ | ✅ | ◐ | ✗ | ◐ | Applies automatically on approval |
| Compensation review cycles | ◐ | ✅ | ◐ | ✗ | ✗ | Per-worker requests; no bulk merit-cycle planning UI |
| Benefit plans and enrollment | ✅ | ✅ | ✅ | ✅ | ◐ | Elections, waivers, employer cost |
| Open enrollment windows | ◐ | ✅ | ✅ | ✅ | ✗ | Plan year and QLE fields exist; no guided enrollment period |
| Carrier feeds | ○ | ✅ | ◐ | ✅ | ✗ | Adapter slot only |
| Payroll-ready change report | ✅ | ✅ | ◐ | ✅ | ✅ | CSV export per period |
| **Running payroll / filing taxes** | ✗ | ✅ | ◐ | ✅ | ✅ | **Deliberately out of scope** — see limitations |
| Contractor payments | ◐ | ✅ | ✗ | ✅ | ✅ | Records and reconciles; does not move money |

## Global / international

| Capability | FSW People | Rippling-style | BambooHR-style | Gusto-style | Deel-style | Notes |
|---|---|---|---|---|---|---|
| Multi-country workers as first-class | ✅ | ✅ | ◐ | ◐ | ✅ | PH is not modelled as an awkward US record |
| Local currency, timezone, holidays | ✅ | ✅ | ◐ | ◐ | ✅ | |
| Country-specific onboarding | ✅ | ✅ | ◐ | ✗ | ✅ | |
| Local identifier capture (encrypted, optional) | ✅ | ✅ | ◐ | ✗ | ✅ | PH TIN/SSS/PhilHealth/Pag-IBIG |
| W-8BEN / foreign tax form tracking | ✅ | ◐ | ✗ | ◐ | ✅ | Tracked; the system never decides which form applies |
| Data privacy notice and consent tracking | ✅ | ◐ | ◐ | ✗ | ✅ | PH Data Privacy Act principles |
| EOR / entity-of-record services | ✗ | ◐ | ✗ | ✗ | ✅ | A service, not software — `EOR` engagement type is supported as a classification |
| Multi-currency FX roll-up | ◐ | ✅ | ✗ | ✗ | ✅ | Cost roll-ups are USD-only; no FX rate source |

## Automation, compliance, governance

| Capability | FSW People | Rippling-style | BambooHR-style | Gusto-style | Deel-style | Notes |
|---|---|---|---|---|---|---|
| Workflow automation builder | ✅ | ✅ | ◐ | ✗ | ◐ | 16 triggers, 10 action types, 8 templates, run log |
| Reusable approval engine | ✅ | ✅ | ◐ | ✗ | ◐ | Sequential; decisions immutable |
| Universal task system | ✅ | ✅ | ◐ | ✗ | ◐ | Every module feeds one queue |
| Data-driven compliance rules | ✅ | ◐ | ◐ | ◐ | ◐ | Jurisdiction, source URL, review date — updated without a deploy |
| Configurable retention with approval gate | ✅ | ◐ | ◐ | ◐ | ◐ | Calculates eligibility; destruction needs explicit approval |
| Append-only audit log | ✅ | ✅ | ◐ | ◐ | ◐ | **Database-enforced**, not just convention |
| Audited exports with permission checks | ✅ | ✅ | ◐ | ◐ | ◐ | Report permission checked, not just export permission |
| Document vault with versions and e-sign | ✅ | ✅ | ✅ | ✅ | ✅ | Internal acknowledgment; DocuSign/Adobe for statutory cases |
| Policy management with versioned acks | ✅ | ✅ | ✅ | ◐ | ◐ | Prior versions and their acks preserved |
| Reporting and executive dashboard | ✅ | ✅ | ✅ | ◐ | ◐ | 11 reports, permission-filtered |
| Scheduled report delivery | ◐ | ✅ | ✅ | ◐ | ✗ | `ReportDefinition.schedule` exists; no delivery job |
| Import center with validation preview | ✅ | ✅ | ✅ | ✅ | ◐ | Validate → preview → confirm |
| SSO / SCIM | ○ | ✅ | ✅ | ◐ | ✅ | Architected; needs Entra ID credentials |
| Mobile app | ◐ | ✅ | ✅ | ✅ | ✅ | Responsive web, not a native app |
| Public API | ◐ | ✅ | ✅ | ◐ | ✅ | Internal endpoints exist; no versioned public API surface yet |

---

## Where FSW People is genuinely stronger

These are consequences of building for one company rather than for a market:

1. **The audit log cannot be edited, by anyone.** A database trigger rejects `UPDATE` and
   `DELETE` on audit events and document signatures — including from the application's own
   credentials. Most products enforce this in application code only.
2. **Compliance rules are data with citations.** Every rule carries its authoritative source
   URL and a review date. Nothing about I-9 or W-4 is frozen into code, and the product tells
   you to verify with counsel rather than implying certainty.
3. **PTO balances cannot drift.** There is no stored balance to disagree with its history.
4. **The manager boundary is tested, not asserted.** `tests/integration/permissions.test.ts`
   proves a manager cannot reach a report's SSN, date of birth, home address or pay, and that
   IT cannot reach any of it.
5. **Retention has a human gate.** The system calculates eligibility but will not destroy
   anything without a documented approval, and preserves employment history when it does.
6. **Honest scope.** Payroll filing, certified electronic I-9 and EOR services are marked as
   out of scope rather than half-implemented.

---

## Gaps worth closing next

In rough priority order for FSW Group:

1. **Entra ID SSO** — the highest-value integration; the architecture is ready.
1b. **PDF résumé text extraction** — Indeed Apply supplies structured résumé text, but a
    PDF arriving any other way still has to be pasted in by hand.
2. **S3 driver implementation** — required before multi-node production deployment.
3. **Peer/360 review UI** — the data model already supports it.
4. **Compensation cycle planning** — bulk merit planning with budget roll-up.
5. **Open enrollment windows** — a guided period rather than ad-hoc elections.
6. **Scheduled report delivery** — the schema field exists; needs a delivery job.
7. **9-box and succession planning** — for executive talent review.
8. **Multi-currency roll-up** — needs an FX rate source and a policy on rate dates.
9. **Native mobile app** — the responsive web app covers phone use today.
10. **Versioned public API** — for other FSW systems to consume approved HR data.

---

## Explicit non-goals

These are not gaps; they are deliberate decisions:

- **Running payroll and filing taxes.** Regulated, high-consequence, and well served by
  established providers. FSW People prepares the data and integrates.
- **Certified electronic I-9 completion.** Tracking and retention are implemented; certified
  electronic completion has additional legal and technical requirements and belongs with a
  specialist provider.
- **Being a legal authority.** The compliance center is a workflow and risk-management tool.
  It surfaces obligations with citations and review dates, and says "verify this with
  HR/legal/your payroll provider" rather than giving false certainty.
- **Employer-of-record services.** That is a service business, not software. `EOR` is
  supported as an engagement classification for workers employed through a third party.
