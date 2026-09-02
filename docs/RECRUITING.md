# The recruiting module (ATS)

FSW Talent Scout runs the whole hiring process, not only the assessment: a role is
raised, approved, advertised, applied to from several sources, worked as a
pipeline, interviewed against a structured kit, and offered — with the
assessment as one stage inside that.

## The shape of the data

A **Candidate** is a person. An **Application** is that person's participation
in one **Requisition**. Someone who applies to three roles is one candidate
with three applications. This is the shape the established tools use, and the
only one in which duplicate detection, source attribution and cross-role
reporting are possible at all.

**Pipeline stages** are rows on the requisition, not a fixed enum, because
every role recruits differently and a fixed pipeline forces teams to
misreport their process — after which the funnel report measures nothing. A
stage's *kind* (`APPLIED`, `SCREEN`, `ASSESSMENT`, `INTERVIEW`, `REFERENCE`,
`OFFER`, `HIRED`) is the contract the software acts on; its *name* is
cosmetic, so "Phone screen", "Recruiter chat" and "Intro call" still compare
across roles.

**Stage history is append-only.** Funnel conversion and time-in-stage are
computed from `ApplicationStageEvent` rows rather than from an application's
current state, so the numbers survive later edits and show the path an
application actually took.

## Requisitions

Created as a draft. Approvers are named in order; each is asked only once the
one before approved, so a rejection stops the chain instead of wasting
everyone's time. Only an **OPEN** requisition appears on the careers page or
in the job feed — closing a role removes it from both.

Publishing a salary range is a checkbox and defaults to on. It is required in
a growing number of jurisdictions and postings that state a range draw
better-matched applicants everywhere else.

## Sourcing: how roles reach job boards

Boards are **fed, not scraped**. Scraping Indeed or jobs.ph for candidate data
would breach their terms and harvest data nobody agreed to share with us; it
is not built and is not a gap.

There are three routes out, all rendering from one `PublicPosting` so they can
never drift and describe the same role differently:

| Route | What it is | Who consumes it |
| --- | --- | --- |
| `/api/feeds/jobs.xml` | Indeed job-sync XML format | Indeed and the programmatic-advertising ecosystem |
| `/careers/<ref>` JSON-LD | schema.org `JobPosting` | Google for Jobs, and aggregators that crawl rather than ingest |
| `/careers` | The careers site itself | Direct applicants |

The JSON-LD route is the practical answer for boards that publish no
integration API — **jobs.ph** among them. Give a board the feed URL once and
every future role reaches it without anyone re-typing a posting.

### Routes in

| Transport | Endpoint | Notes |
| --- | --- | --- |
| Careers site | `POST /api/careers/apply` | Rate limited per IP; résumé upload and text extraction |
| Board / partner API | `POST /api/inbound/applications` | Per-channel bearer token |
| Manual | Admin UI | Recruiter-entered candidates |

To give a board API access, set a token on its `SourceChannel` — the hash is
stored, never the token. One token per source means a compromised board
credential is revocable on its own and every application carries provable
attribution.

**Every inbound payload is stored raw before parsing** (`InboundApplication`).
Boards change formats without warning and applicants apply once; a parse
failure must never cost a real person their candidacy.

### Attribution

Captured in the browser at submit time, because it cannot be reconstructed
afterwards — the referrer and campaign parameters exist only on that page
load. Precedence is explicit over inferred: our own `?src=` beats a
`utm_source` we did not control, which beats a referrer header the browser may
not even send. An unrecognized source is recorded as `other` rather than
silently credited to the careers site, which would overstate it.

## Screening

Screening questions are per requisition. A knockout rule **flags an
application for human review** — it never rejects anyone, never sends a
rejection, and never hides the application from the board.

That restraint is the design. Automatic rejection on a self-reported answer is
how applicant tracking quietly filters out capable people: the candidate who
answers "no" to a degree question but has ten years of the work, the person
whose visa situation is more complicated than a yes/no. The rule fires, the
recruiter sees exactly why, and a person decides.

A non-numeric answer to a numeric rule does not fire — a data problem must not
become a candidate problem.

## Structured interviewing

An **interview kit** holds the competencies and questions for a stage. Every
candidate for a role is asked the same things and rated on the same
attributes, which is what makes the ratings comparable and the process
defensible.

Scheduling an interview opens a **scorecard** for each participant
immediately, which is what makes "who still owes a scorecard" answerable.

Scorecards are **four points with no midpoint**. A neutral option lets an
interviewer avoid committing, and a panel of maybes is indistinguishable from
no interview at all. Submitting requires a written rationale, and a submitted
scorecard is sealed and visible only to its author until filed — editing after
hearing the panel is not an independent evaluation, and independence is the
entire reason they are collected separately.

Aggregation surfaces a **split panel** as a split rather than averaging it
away. An average of 2.5 hides a disagreement, which is exactly what a hiring
manager most needs to see.

## Offers

An offer runs a state machine (`src/lib/ats/offers.ts`) with an approval chain
and a hard gate on sending. Sending checks the transition, the approvals, the
response deadline, the candidate's email address, and every merge field in the
letter.

**Offer letter templates are authored by the employer and reviewed by their
counsel.** The seeded template leaves the legally significant clauses as a
bracketed prompt — the platform supplies the merge mechanism, not contractual
language.

An unfilled `{{placeholder}}` blocks the send and the blocker says where the
field is filled in. A letter that silently drops a salary figure gets sent; one
that visibly says `{{baseSalary}}` gets noticed.

**The rendered letter is frozen onto the offer when it is sent.** A later
template edit cannot retroactively change what someone was offered.

Acceptance takes a typed signature and records the time, IP and user agent —
what makes an electronic acceptance evidentiary rather than a database flag.
The link is single-use and spent on either decision.

## Duplicate candidates

The same person applies through a board on Monday and the careers page on
Thursday, with a different email and their name spelled differently. Left
alone they become two candidates, get contacted twice, and their history is
split in half.

`src/lib/ats/dedupe.ts` proposes matches; a human confirms. Nothing merges
automatically: a wrong automatic merge fuses two real people's records
together, which is far harder to unpick than a missed duplicate.

Emails normalize plus-tags everywhere and dots only on Gmail, where they are
genuinely insignificant. Philippine mobile numbers are compared on their last
nine digits, so `09171234567`, `+639171234567` and `63 917 123 4567` match.
Given name and surname are compared **separately** — a whole-string budget let
a long surname pay for a wrong given name and matched "Bea Cruz" to "Ana Cruz".

## Analytics and compliance

Rates are withheld below a sample floor. A conversion rate from four
applicants is noise wearing a number. Open stages are measured up to now, so a
stalled pipeline reads as stalled rather than fast.

**Adverse impact is analyzed at every stage**, not only the assessment
(`src/lib/ats/stage-impact.ts`). The Uniform Guidelines apply to any procedure
used as a basis for an employment decision — a résumé screen and an
interviewer's judgement included — and in practice the largest disparities
usually appear at the least structured step. Measuring only the assessment
measures the one stage already designed to be measurable.

It needs the voluntary self-identification module switched on (Settings →
Fairness and candidate experience) and enough people who chose to answer. See
`docs/FAIRNESS-AND-FEEDBACK.md`.

## Permissions

| Role | Recruiting scope |
| --- | --- |
| `SUPER_ADMIN` | Everything |
| `HR_ADMIN` | Create and run requisitions, pipeline, interviews, offers |
| `HIRING_MANAGER` | Runs their own roles: pipeline, interviews, scorecards, approvals. Does not create requisitions or send offers |
| `ASSESSMENT_ADMIN` | Assessment configuration only |
| `VIEWER` | Read-only |

## Things a recruiter should know

- A stage move can **skip stages and go backwards**. A referral who already met
  the hiring manager should not be walked through a screen for the software's
  benefit; the move is recorded either way, so the funnel shows what really
  happened.
- Marking someone **Hired** requires an accepted offer. It is the one stage the
  software will not let you reach by accident.
- **Rejection always asks for a reason.** Partly reporting — you cannot improve
  a funnel you cannot explain — and partly the discipline of naming the ground
  for a decision that affects a real person.
- Re-applying to the same role does not create a second application or reset
  anyone's progress.
