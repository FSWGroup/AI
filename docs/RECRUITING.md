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

## Self-scheduling

The back-and-forth to book one interview costs more recruiter time than
anything else in the pipeline, and every day of it is a day the candidate
spends talking to someone else. A scheduling link replaces it: the candidate
picks from times the panel is actually free.

### Time is stored in UTC and shown in yours

Every instant in the database is UTC. Availability is written the way people
think about it — "Tuesdays, 9 to 5" — which is a statement about a wall clock
in a particular place, so every interviewer has an IANA time zone and windows
are converted through it.

Conversion uses `Intl.DateTimeFormat` against the runtime's own zone database
(`src/lib/scheduling/timezone.ts`), so it stays correct through
daylight-saving changes with no table to maintain. Somebody who said "9am"
means 9am on both sides of a clock change, even though the two UTC instants
are an hour apart — there is a test for exactly that.

The candidate's page detects their browser's zone, renders every time in it,
and **names the zone on the page**. Every scheduling mix-up starts with a time
shown without saying whose clock it is on.

### Panel coordination

A slot is offered only when **every required panelist is free for the whole of
it**. Optional panelists never remove a slot; they are reported alongside so a
recruiter can see which times get the fullest panel.

Offering a time that then has to be taken back is worse than offering fewer
times, because the candidate has already told their current employer they need
that hour. So: no slot that overruns the end of a free window, a minimum
notice period, and a **re-check at the moment of booking** — the list on the
candidate's screen was computed when their page loaded, and this is what stops
two candidates booking the same panel for the same hour.

### Reschedule, cancel, remind

Both are on the same link. A candidate who needs to move an interview at 9pm
should not have to find a recruiter's email address. Reschedules are capped
(twice by default) and the interview being moved does not block its own new
time.

Reminders are queued when an interview is booked — candidate at 24 hours and
1 hour, panelists at 24 hours — and **rewritten from scratch on every
booking**, so a moved interview never leaves a reminder pointing at the old
time. Cancelling marks them cancelled rather than leaving them to fire. Send
them with `npm run reminders:run` on a cron; the job marks each sent before
attempting delivery, because two reminders read as a mistake and none reads as
an outage.

### The calendar seam

`src/lib/calendar/` is modelled on the storage provider: one interface, an
internal default, room for Google or Microsoft later without touching the
scheduling logic.

The internal default is **not a stub**. Busy time comes from this platform's
own scheduled interviews, which is the source that actually prevents
double-booking a panel, and every interview produces an **.ics file**, which
every calendar application understands with no integration, no consent screen
and no token to refresh. For a candidate — who by definition has no account
with us — it is the only mechanism that can work at all.

What it cannot see is a dentist appointment. An organization that needs that
connects a real provider; `getCalendar()` is the one place that changes, and
`readsExternalBusy` says plainly whether the platform can see beyond its own
records.

## Work samples

A candidate does a piece of the actual job, and more than one person grades it
against a rubric written before anyone saw the work. `WORK_SAMPLE` is a
pipeline stage kind and appears in the default pipeline between the assessment
and the first interview.

Of everything in this platform, this is the closest thing to watching someone
do the job — which is exactly why the grading controls matter more here than
anywhere else. An unblinded, single-grader, rubric-free work sample is an
interview that took the candidate four hours instead of forty minutes.

### The rubric comes first

A work sample cannot be activated until its rubric passes validation, and it
cannot be sent to anyone until it is active. Every level of every criterion
needs a **written anchor**: two graders reading "level 3" otherwise supply
their own definitions and never find out they differed. The scale is four
points with no midpoint, the same as a scorecard and for the same reason.

The candidate is shown "what we are looking for" alongside the task. Hiding
the standard does not measure skill, it measures guessing.

### Delivery

The candidate's side works like an assessment section: a single-use token, a
**server-authoritative clock** set when they start, and autosave as they type.
The browser countdown is display only, every autosave re-syncs it from the
server, and refreshing or closing the laptop never adds time. Task
instructions are withheld until the clock starts — handing them out first
turns a timed task into an untimed one.

The link is shown once, when the sample is sent. The token is stored only as a
hash, so a lost link is reissued rather than looked up.

### Blind grading

Graders see a reference (`WS-XXXXXX`), never a name — including in the
filename of a downloaded file. A grader is under the blind until they file,
and **the blind follows the ability to grade, not whether a grade row exists
yet**: someone who could grade this submission but has not started has no row,
and keying off the row would treat them as a bystander at exactly the moment
their view is most easily contaminated. Oversight opens the panel only for
people who cannot grade it themselves.

Submitting requires written evidence, not just levels. A filed grade cannot be
edited except as an explicit **reconciliation**, and the revision is recorded
as one — an independent grade and a grade revised after reading a colleague's
are different evidence, and the record has to say which it is holding.

### Reconciling rather than averaging

Two graders two or more levels apart on any criterion, or a full level apart
overall, are flagged for reconciliation. They talk, then either revises. The
mean is shown *alongside* the individual grades and never instead of them: an
average of 1 and 4 is 2.5, which describes neither grader and is the number
most likely to be quietly wrong.

A criterion a grader could not assess is excluded and the remaining weights
renormalized, rather than scored as the bottom level. "The submission did not
show this" is a fact about the submission; scoring it 1 would turn it into a
judgement of the person.

### What it does not do

Nothing here moves an application and no score crosses a threshold anywhere.
The grades are evidence for a person to weigh against everything else they
know.

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

## Talent pool (the people who nearly got the job)

Already sourced, already assessed, already interviewed, already interested.
Losing them because the requisition closed is the most expensive ordinary
mistake in recruiting.

But a person who applied for one job did not thereby agree to sit in a
marketing database indefinitely, and the whole module is built around that.

### The consent gate

| Rule | Why |
| --- | --- |
| Applying is not consent | A profile exists only once someone has been **asked**, and asking is recorded |
| Silence is not consent | `INVITED` means "asked, no answer" and permits nothing |
| An opt-out is permanent | It cannot be reversed by anyone inside the organization. Only the person can come back, by applying again |
| Consent expires | Membership lapses on the retention schedule (`TALENT_POOL_RECORDS`), so nobody is kept forever by default |
| One approach every 30 days | Someone who agreed to hear about relevant roles did not agree to be a mailing list |

`OPTED_IN` is reachable **only** from the candidate's own link. There is
deliberately no admin endpoint that sets it, because it is the one fact here
that has to come from the person it is about.

People who opted out do not appear in search at all — a recruiter should not
be able to browse the list of people who declined.

### The suppression list

An opt-out is recorded twice: on the profile, and as a **hash of the email
address** on a separate permanent list. The second one is the important one.
It has to outlive the deletion of the person's record — otherwise purging
their data under the retention policy would erase the fact that they asked not
to be contacted, and the next import would add them straight back. Storing the
hash lets a future address be checked without keeping the address itself.

Addresses are normalized before hashing, so a plus-address does not defeat
someone's opt-out.

The retention job leaves this list alone on purpose.

### Matching, not scoring

When a role opens, the requisition's pipeline tab shows **past applicants worth
another look**, and every one comes with reasons in words: applied for the same
kind of role, reached a late stage, turned down for process reasons rather than
qualifications, shares tags with the search.

There is deliberately **no fit score and no ranking by one**. A match score
over past applicants is an automated assessment of people for employment
purposes, and once it exists everyone downstream treats it as a measurement
rather than the crude keyword-and-history heuristic it actually is. Reasons can
be read and argued with; a number can only be trusted or ignored.

Ordering is by how far a real process took someone — a fact about what humans
already decided, not a prediction. "Applied here once" is not a reason to
surface anybody.

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
| `ASSESSMENT_ADMIN` | Assessment configuration only, plus authoring work samples — the same discipline as writing an assessment item |
| `VIEWER` | Read-only |

Work-sample permissions are separate from the rest:

| Permission | Who has it | What it does |
| --- | --- | --- |
| `MANAGE_WORK_SAMPLES` | Super admin, HR admin, assessment admin | Author tasks and rubrics, activate them, send them |
| `GRADE_WORK_SAMPLES` | Super admin, HR admin, hiring manager | Grade a submission, blind |
| `VIEW_ALL_GRADES` | Super admin, HR admin, hiring manager | Read every filed grade — but not before filing your own, if you can grade |
| `MANAGE_TALENT_POOL` | Super admin, HR admin | Search past applicants, manage pools and tags, ask for consent, record outreach. There is no separate "contact" permission — the consent gate decides that and no role overrides it |

## Things a recruiter should know

- A stage move can **skip stages and go backwards**. A referral who already met
  the hiring manager should not be walked through a screen for the software's
  benefit; the move is recorded either way, so the funnel shows what really
  happened.
- Marking someone **Hired** requires an accepted offer. It is the one stage the
  software will not let you reach by accident.
- Keep a **work sample** to a slice of the real job small enough to be fair to
  ask for unpaid — an hour or two, not a weekend. The platform will let you
  set any time limit; the judgement about what is reasonable to ask of someone
  who does not work for you is yours.
- **Rejection always asks for a reason.** Partly reporting — you cannot improve
  a funnel you cannot explain — and partly the discipline of naming the ground
  for a decision that affects a real person.
- Re-applying to the same role does not create a second application or reset
  anyone's progress.
