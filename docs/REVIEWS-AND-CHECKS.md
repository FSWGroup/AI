# Team review, social media review, and background checks

Three features that sit at the end of the pipeline, where the decisions get
consequential. Each is built around a control that the obvious implementation
would have left out.

## Independent team review

**Where:** any application → *Team review* → "Ask the team to review".

A round asks named people to assess a candidate from the record — application,
résumé, assessment, interview write-ups. Each of them rates the criteria (from
an interview kit, if you pick one), gives an overall recommendation on the same
four-point scale as interview scorecards, and writes their reasoning.

### The blind

**In a blind round nobody sees anyone else's review until they file their own.**

Without it, the first review posted becomes the anchor and the rest converge on
it. You end up with four names on one opinion, and the agreement looks like
corroboration when it is just sequence.

Two consequences worth knowing:

- **A filed review is sealed.** No edits after you have read the panel. A
  review you can revise once you know what everyone else thought is not an
  independent one.
- **Oversight does not exempt you.** `VIEW_ALL_REVIEWS` opens every filed
  review to someone who is *not* reviewing this candidate. If you were asked to
  review — hiring manager, department head, whoever — you file first. Seniority
  makes anchoring worse rather than better.

This was a real bug during the build: hiring managers had the oversight
permission and could read the panel before writing their own. `visibleReviews`
now checks whether the viewer is themselves a reviewer in the round, and
`tests/unit/ats-reviews.test.ts` pins it.

### What the boss sees

Someone with `VIEW_ALL_REVIEWS` who is not in the round sees every filed
review side by side: each reviewer's recommendation, their full written
feedback, and their per-criterion ratings — plus a consensus block with the
average, the spread, and a **split-panel warning**.

The average is shown *alongside* the individual reviews, never instead of them.
A mean of 2.5 describes a unanimously lukewarm panel and a violently divided
one identically, and those call for opposite next steps.

The consensus is withheld from anyone still under the blind, since an average
leaks the reviews it summarizes.

---

## Social media review

**Off by default.** Settings → Fairness and candidate experience → "Allow
social media review". Review the process and the candidate-facing wording with
counsel before enabling it.

### What this is not

It is a structured human workflow, not a scanner. That is deliberate, and the
alternatives were rejected for specific reasons:

- **Scraping the platforms** breaches their terms of service.
- **Running a language model over someone's posts** is the highest-risk
  application of one in this product. A public profile broadcasts age,
  religion, disability, pregnancy, national origin and political affiliation
  within seconds, and a model will infer more. Research on résumé screening
  already shows models discriminate on names alone, and a human shown a biased
  machine judgement tends to adopt it rather than correct it.
- **A vendor returning a "risk score"** makes the employer a user of a consumer
  report under the FCRA, with all the disclosure and adverse-action duties that
  follow — the same regime as the background check below, without the candidate
  realizing it applies.

### The controls

| Control | Why |
| --- | --- |
| Available only from the **reference or offer stage** | Screening every applicant exposes the process to protected characteristics hundreds of times over, for people who were never near an offer |
| **Consent first**, then look | Searching first and asking afterwards is not consent |
| The candidate **chooses which profiles** to share | We never search for accounts they did not list, and never ask for passwords |
| The reviewer **cannot be deciding** on the candidate | Enforced: anyone on the requisition as recruiter or hiring manager is refused |
| Findings only in **closed job-relevant categories** | An open notes field is where "seemed unprofessional" ends up, and that is where bias lives |
| Protected-characteristic terms are **blocked at write time** | A finding once written tends to get read |
| The hiring team sees findings, **never the profile links** | Someone who can open them sees everything the process exists to keep out of the decision |

Declining is a first-class button and is recorded as a decline and nothing
more. A consent form where refusing is hard is not a consent form.

### The six categories

Threats of violence · Harassment or abuse of others · Illegal activity ·
Breach of confidentiality · Contradicts the application · Safety risk for this
role.

Each one states on the form what must **not** be recorded under it — for
instance, "breach of confidentiality" explicitly excludes publicly discussing
pay or working conditions, which is legally protected activity in many
jurisdictions.

---

## Background checks (Checkr)

**Requires `CHECKR_API_KEY` and `CHECKR_WEBHOOK_SECRET`.** Without them the
feature reports itself as unconfigured rather than half-working.

**Available only once the candidate has accepted an offer.** Ordering criminal
history earlier is restricted or banned in many jurisdictions (ban-the-box),
and there is no reason to pay for a report on someone who has not said yes.

### We never hold the sensitive data

The integration uses Checkr's **invitation** flow. Checkr collects the SSN,
date of birth, and the FCRA disclosure and authorization directly from the
candidate. None of it passes through this platform — the safest place for data
you do not need is somebody else's system, and the disclosure is presented by
the party legally required to present it.

### "Consider" is not a failure

A `consider` assessment means a human must look at the report and weigh it
against the role. The UI says so where a recruiter will read it.

### The FCRA sequence, enforced

If you then decide not to hire *because of* the report:

1. **Pre-adverse notice**, with a copy of the report and the CFPB's summary of
   rights. The endpoint refuses this on a clear report or an incomplete one.
2. **A waiting period** — five business days, weekend-aware — for the candidate
   to dispute or correct it. The endpoint refuses to send adverse action
   inside it and says how far through the wait you are.
3. **Adverse action notice**, naming Checkr as the source and stating the
   candidate's rights.

Encoding this as a state machine rather than a checklist is the point: the
defence against an FCRA claim is the record of having followed the sequence,
and a checklist is something a busy recruiter clicks through.

Several jurisdictions add their own rules — longer waits, individual
assessment requirements. Those vary too much to hardcode; the federal floor is
enforced and the local overlay is a question for counsel.

### Webhooks

`POST /api/webhooks/checkr` verifies an HMAC-SHA256 signature over the **raw**
body (parsing and re-serializing changes the bytes and every signature fails)
using a constant-time comparison.

Both header spellings seen in the wild are accepted, and
`CHECKR_SIGNATURE_HEADER` overrides the name without a deploy — **confirm the
exact header against Checkr's partner documentation at integration time.**

With no secret set the endpoint returns 503 rather than accepting anything: an
unverified webhook is an open endpoint that mutates hiring records.

Unrecognized events are recorded and acknowledged, not rejected — a 4xx makes
Checkr retry, and retrying will not turn an event we do not handle into one we
do.

## Permissions

| Permission | Who has it | What it does |
| --- | --- | --- |
| `VIEW_ALL_REVIEWS` | Super admin, HR admin, hiring manager | Read every filed review — unless you are in the round yourself |
| `MANAGE_SOCIAL_CHECKS` | Super admin, HR admin | Start a social review, assign a reviewer |
| `CONDUCT_SOCIAL_REVIEW` | Super admin, HR admin | Be the reviewer. Never granted to hiring managers, who decide |
| `MANAGE_BACKGROUND_CHECKS` | Super admin, HR admin | Order checks and run the adverse-action sequence |
