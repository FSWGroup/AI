# Known issues

Open defects and environment limitations, with what was established about each.
Anything fixed lives in the git history instead.

---

## 1. Brand research against fswelsford.com was blocked

The brief asked for the visual language to be derived from
`https://www.fswelsford.com`. The container's egress proxy refused the request
(`EGRESS_BLOCKED`), so the site could not be inspected.

The palette and typography were built instead from the written direction in the
brief — FSW navy and deep blue, Welsford blues, steel and grey neutrals,
restrained accents, predominantly light surfaces. Every value is a token in
`src/app/globals.css`, so aligning to the real site is a token edit, not a
refactor. **Verify against the live site before any external release.**

---

## 2. Demonstration content is illustrative, not approved policy

Seeded SOPs, courses and compliance rules exist to make the platform
demonstrable. They are labelled as examples in the seed data and must not be
treated as FSW policy. Where a screen touches a regulatory question it shows
"Verify requirement with qualified legal/safety advisor." Replace the seeded
content before any real rollout.

---

## 3. Areas with the thinnest verification

Not defects, but where to look first if something is wrong.

- **Deep authoring flows.** The block editor, course builder, question editor and
  path builder are covered at the load-and-render level, not click-by-click. The
  learner and security paths are covered thoroughly.
- **Load and concurrency.** Nothing has been run against realistic concurrency or
  a five-thousand-person organization. Size the Prisma connection pool before you
  find out the hard way — see the note in `DEPLOYMENT.md`.
- **Dark mode.** Architected as semantic tokens with the inversion points in
  place, but only the light theme has been designed and tested.

---

## Resolved

Recorded here only because the investigations were long and the conclusions are
worth not re-deriving. Details are in the git history.

### Client-side navigation committed only intermittently — fixed

In production builds, clicking a `next/link` often did nothing: no error, no
feedback, the URL simply unchanged. Roughly two attempts in three failed.

**Cause: a file-based `loading.tsx` route boundary.** With one present above the
segment being navigated to, transitions intermittently failed to commit. Removing
it makes navigation reliable, and the application is fast enough (70–120ms server
renders) that no fallback is needed — Next keeps the current page visible until
the next one is ready.

Measured with the same build and a six-attempt probe for each arrangement, across
two navigation shapes — cross-segment (catalog into a course page) and
same-segment with different search params (a My Training filter tab):

| Arrangement | Cross-segment | Same-segment |
| --- | --- | --- |
| `app/loading.tsx` (original) | 2/6, then 1/6 | failing |
| `app/(app)/loading.tsx` | 6/6 | 1/6 |
| no loading boundary | 6/6 | 6/6 |

Note the middle row: moving the boundary into the route group fixed cross-segment
navigation and looked like the answer, but same-segment navigation still failed.
Only removing it entirely fixed both. A root-level boundary is the worst case
because it wraps the whole document, so every transition has to unmount the
application shell.

The symptom was misleading and cost a lot of time, so for the record: the click
was received and its default prevented, the RSC response returned 200 with a
complete payload in 54–120ms, `history.pushState` was never called, and the
browser then aborted the response body. No chunk request, no console error, no
`pageerror`, no error boundary. Plain anchors always worked and `next dev` was
unaffected, which is what made it look like a framework bug rather than
application code.

Ruled out along the way, none of them the cause: link prefetching, React 19.1.1
vs 19.2.8, duplicate React copies, `scroll-behavior: smooth`, Prisma pool size,
server render time, server-action module placement, and parallel or intercepting
routes. Two earlier conclusions were wrong and were reverted — moving the
self-enrol action out of the route directory, and removing the enrol button from
the catalog — because each appeared to fix it in a single run. The failure is
probabilistic, so a single passing attempt proves nothing; six is the minimum that
separates signal from luck.

**If a page later needs a loading indicator**, do not reintroduce a route
boundary without re-running that probe. Prefer a per-link pending state
(`useLinkStatus`) or an in-page skeleton rendered by the page itself, neither of
which introduces a route-level Suspense boundary.
