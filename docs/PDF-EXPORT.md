# The complete assessment export

**Candidates → a completed candidate → Download PDF.** One file containing
everything the portal shows about an assessment, meant to be sent to a
colleague who does not have an account.

## Order

The document is ordered for someone who was not in the room and may only read
the first two pages:

1. **Cover** — candidate, role, record ID, who exported it and when, and the
   confidentiality notice.
2. **Contents** — with real page numbers.
3. **Executive summary** — strongest alignment, what to investigate, how much
   confidence the results deserve, and the disclaimer.
4. **Results at a glance** — every dimension on the 1–9 scale with the role's
   target range tinted and the candidate's band filled.
5. Dimension-by-dimension detail (aptitudes, then performance scales).
6. Response quality (validity) indicators.
7. Areas flagged for additional interview attention, where configured.
8. Sales trait and leadership composites, where the role uses them.
9. The targeted interview guide, with alternate wordings and what to listen for.
10. Development suggestions.
11. The AI interview brief, if one was generated — labelled as machine-generated.
12. Session record: administration, section timings, accommodations, consents.
13. Session integrity log, every recorded event, in readable form.
14. **How to read this report** — bands, ranges, the difference between the
    timed aptitudes and the self-report scales, and what the instrument
    cannot tell you.

Sections with no data are omitted rather than printed empty, and the contents
page is numbered from where sections actually land — `tests/unit/full-report-pdf.test.ts`
asserts that every entry's page number resolves to a page carrying that title.

## What it deliberately leaves out

- **The webcam recording.** Who may view a recording is a separate, audited
  permission (`recordingAccessRoles`). A PDF cannot carry that permission with
  it, so recordings stay in the portal.
- **The candidate's résumé.** It is their document, not the platform's to
  redistribute. What the AI brief concluded from it is included.
- **Any recommendation.** No overall fit score, no ranking, no hire/pass
  language anywhere. A unit test asserts the absence.

## Why pdf-lib and not headless Chromium

The platform's older PDF path prints the web report with `playwright-core`,
which needs a Chromium binary at runtime. Serverless hosts — including the
Netlify Functions this deploys to — do not have one, so that button could only
ever return an apology there.

`pdf-lib` is pure JavaScript and runs anywhere, but it draws at absolute
coordinates and knows nothing about paragraphs or page breaks. `src/lib/report/pdf-layout.ts`
supplies those: a cursor-based builder with word wrap, page breaks, tables,
panels, the 1–9 band scale, and a running header/footer stamped at the end
(page totals are unknowable until the document is finished).

One wrinkle worth knowing: the 14 standard PDF fonts are **WinAnsi**-encoded,
and a character outside that set makes pdf-lib throw mid-render. WinAnsi is
wider than Latin-1 — its 0x80–0x9F range carries the curly quotes, en and em
dashes, ellipsis and bullet — so the report's typography survives intact.
Only genuinely unencodable characters (→ ↔ ≤ ✓) are substituted, and anything
still unknown becomes a space rather than an exception: losing one glyph beats
losing the whole document.

## Traceability

The file leaves the system the moment it is downloaded, so:

- the exporter's name and the export time are stamped on the cover,
- every page carries `Confidential — do not distribute externally`,
- the download writes a `report.exported` audit event recording who exported
  it, whether the AI brief was included, and how many integrity events it
  carried,
- the response is sent `Cache-Control: private, no-store` so no shared cache
  retains personal data.

Access is the same gate as the web report: `VIEW_REPORTS` plus the caller's
job-profile scope.
