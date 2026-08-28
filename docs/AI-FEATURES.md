# FSW WorkFit — AI Decision-Support Features

Two AI features assist human judgment. Neither makes, influences, or records
an employment decision.

| Feature | Where | What it produces |
| --- | --- | --- |
| **Interview preparation brief** | Candidate → *Résumé & AI Brief* | Role context, what the results mean for the role, résumé/assessment corroboration and tensions, targeted interview questions with listen-fors, reference prompts, onboarding considerations, interpretation cautions |
| **Job-description benchmark proposal** | Job Profile page | Proposed enabled dimensions, 1-9 ranges, weights, per-dimension rationale, module flags, assessment emphasis, interview themes, cautions |

## Setup

Set `ANTHROPIC_API_KEY` in the environment (Netlify: Site configuration →
Environment variables, all scopes), then redeploy. Without it both features
show a clear "not configured" notice and everything else in the product
works unchanged — no errors, no broken pages.

Model: `claude-opus-5`. Roughly 20-60 seconds and a few cents per analysis.
Rate limited to 20 analyses per admin per hour.

## Design rules, and why they exist

These are enforced in code (`src/lib/ai/client.ts` → `SHARED_GUARDRAILS`),
in the output schemas, and in the UI copy.

**1. No verdicts.** The model may never recommend hiring, rejecting,
advancing, or ranking, and the output schemas contain no field that could
carry one. This is deliberate: NYC Local Law 144 defines an "automated
employment decision tool" partly by whether it emits a *simplified output* —
a score, tag, classification, ranking, or recommendation — that
substantially assists a decision. A grounded narrative that asks questions
is not that; a "strong hire" label is.

**2. AI never touches scores.** Assessment scores, bands, benchmark
comparisons, and reports are computed deterministically
(`src/lib/scoring/`) and are byte-identical whether or not AI is
configured. The brief reads scores as fixed input.

**3. Identity is redacted before the model sees a résumé.**
`src/lib/ai/redact.ts` strips the candidate's name (including run-together
handle forms), email, phone, street address, postal code, and links.

This one is not decoration. LLMs show measurable name-based preference in
résumé screening — one large study found white-associated names preferred
85% of the time and female-associated names 11%. And a human reviewing a
biased AI summary does not correct it: in a 2025 study, participants shown
a biased AI's recommendations favored the AI-preferred group up to 90% of
the time *even when they rated the AI's output as low quality*. "Human in
the loop" is therefore not, by itself, a safeguard — which is why the
identity signal is removed before it can anchor anything. Postal codes are
redacted specifically because Illinois HB 3773 names ZIP codes as a
prohibited proxy for protected characteristics.

**4. No protected-characteristic reasoning.** The system prompt forbids
inferring or discussing any protected characteristic, and forbids
estimating them from names, schools, or dates.

**5. Nothing is auto-applied.** A benchmark proposal loads into the editor;
a human reviews each range and presses Save. The person who saves the
benchmark owns it — which is what makes it defensible under the Uniform
Guidelines, where cutoffs must be "reasonable and consistent with normal
expectations of acceptable proficiency within the work force."

**6. Everything is traceable.** Every run stores the model, prompt version,
inputs used, token counts, and requesting user (`AiAnalysis` table), and
writes an audit event including which identifier classes were redacted.

## Interview questions: a deliberate limit

The brief generates questions **for the interviewer to consider**, not a
per-candidate interview script that replaces the standard guide. Structured
interviews earn their validity (currently the highest of any single
selection method, r ≈ .42) from *procedural consistency* — the same
questions, scored the same way, for every candidate for a role. Generating a
different interview per candidate would quietly destroy that.

The recommended use: run the brief for several candidates for a role, take
the recurring themes into your standard question set for that role, and use
the candidate-specific items as follow-up probes rather than as the
interview itself.

## Résumé handling

- Accepted: PDF, DOCX, TXT/MD, up to 10 MB. A paste-text fallback is always
  available and is used automatically when extraction fails (e.g. a scanned
  PDF).
- Files go to private object storage under
  `candidate-documents/{attemptId}/`; only extracted text is stored in the
  database. Nothing is shown to candidates.
- Uploads and deletions are audited. Deleting a résumé removes the stored
  file and the extracted text.

## What still needs doing before heavy reliance

- **Counterfactual bias testing** of the brief: run identical résumés with
  swapped name/gender/school signals and confirm outputs do not differ.
  Do this under counsel — bias-testing data may be privileged.
- **Jurisdiction check.** If you assess candidates in Illinois, New York
  City, California, Colorado, or the EU, review `docs/VALIDATION-ROADMAP.md`
  and take legal advice on notice and audit duties before enabling AI
  features at scale.
- **Never enable per-candidate question generation as the interview itself**
  without addressing the consistency problem above.
