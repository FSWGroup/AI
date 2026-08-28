# Video

How FSW Academy handles video: playback tracking, the AI Video Studio pipeline,
the provider architecture, and SOP-to-video version tracking.

---

## Why video is a first-class format

Some knowledge does not transfer well as text. Showing someone the quote entry
screen for ninety seconds beats three paragraphs describing it. But traditional
LMS video has two failures FSW Academy addresses directly:

1. **Opening a video is treated as watching it.** So completion records mean
   nothing.
2. **Producing video is expensive**, so it never gets made, and when a procedure
   changes the video silently goes stale.

Playback tracking solves the first. The AI Video Studio and version tracking
solve the second.

---

## Playback tracking

Video lessons record real progress, not attendance.

`LessonProgress` stores `videoPositionSeconds` and `videoWatchedPercent`
separately. The player reports progress to `/api/progress` every 10 seconds and
on pause and end. The server enforces:

- **Monotonic progress** — a reported position never lowers the stored maximum
- **Rate limiting against wall-clock time** — a jump larger than the elapsed real
  time between updates, plus tolerance, is rejected

That second rule is what stops scrubbing to the end from registering as watching.
Position and watched-percent are tracked apart precisely because seeking back to
review should not reduce credit, while seeking forward should not grant it.

Completion requires `videoWatchedPercent >= course.requiredVideoPercent`
(configurable per course at 50, 75, 90, or 100; default 90). Resume playback comes
from the stored position.

Every video also carries a caption track and a transcript. That is an
accessibility requirement, and it makes video searchable — video transcripts are
indexed for global search and AI retrieval, so an answer can come from something
someone said on screen.

---

## Video sources

| Source | How |
|---|---|
| Upload | File picker or drag-and-drop |
| Record webcam | Browser `MediaRecorder` |
| Record screen | `getDisplayMedia` |
| Record screen + webcam | Composited |
| Embed external | Supported providers by URL |
| **Generate with AI** | The Video Studio, below |

Uploads are validated on extension **and** sniffed magic bytes, size-limited, and
served only through the authorized, sandboxed `/api/media/[id]` route. Nothing is
publicly addressable.

---

## AI Video Studio

The workflow that turns a written procedure into a training video.

```
Source                                    (prompt, SOP, course, document, transcript)
  ↓
AI extracts learning objectives
  ↓
AI drafts a 2–5 minute script
  ↓
AI generates a storyboard (scenes, narration, on-screen text)
  ↓
█ AUTHOR EDITS AND APPROVES █             ← the pipeline stops here, always
  ↓
Narration audio generated (TTS)           (skipped cleanly when unconfigured)
  ↓
FSW-branded scenes rendered
  ↓
Optional AI avatar presenter              (only with a provider key)
  ↓
Captions timed and written (VTT)
  ↓
Video rendered to MP4
  ↓
Author previews
  ↓
Published into the SOP or course
```

**The author edit step is mandatory, not optional.** Everything — objectives,
script, per-scene narration, on-screen text, knowledge checks — is editable
before a single frame renders. A video that goes straight from prompt to
published is a liability; a video an author shaped is training material.

### Video modes

| Mode | For |
|---|---|
| FSW Branded Explainer | Concepts and process overviews |
| Screen Procedure Walkthrough | Step-by-step system tasks |
| Presentation / Narrated Slides | Structured content with talking points |
| AI Avatar Presenter | A presenter-led delivery (requires an avatar provider) |
| Quick Training Clip | Short, single-point reminders |
| Safety / Compliance Briefing | Formal briefings with emphasis on warnings |

Each mode changes the scene direction the planner produces — a safety briefing
gets warning emphasis and slower pacing; a quick clip gets one idea and no
preamble.

### Options

Voice, speed, tone, language, aspect ratio (16:9 at 1920×1080, 9:16 at 1080×1920,
1:1 at 1080×1080), and avatar where available. Output is H.264 MP4.

Branded elements: FSW intro and outro, logo, brand typography and colors, lower
thirds, chapter titles, highlight boxes, callouts, screenshots, diagrams, step
lists, optional background audio, and narration. Brand values come from
Admin → Settings → Brand and are passed into the render request — providers never
read settings directly.

---

## Render jobs

Rendering is a background job with visible status:

```
QUEUED → GENERATING_SCRIPT → AWAITING_REVIEW → GENERATING_AUDIO
       → CREATING_SCENES → RENDERING → UPLOADING → COMPLETE
                                                 ↘ FAILED / CANCELED
```

`VideoJob` carries `status`, `progress` percent, `error`, `attemptCount`, the
editable `plan`, and `outputMediaId`.

Jobs are **idempotent and retryable**: a handler checks current status before
acting, so a retry after a crash resumes rather than duplicating. A failed job
parks in `FAILED` with its error message, and an administrator can retry it from
the Video Studio.

Rendering happens on the worker, never in a request. The web tier does not need
ffmpeg; the worker does.

---

## Provider architecture

`VideoProvider` (`src/lib/ai/types.ts`):

```ts
interface VideoProvider {
  key: string;
  label: string;
  supportedModes: string[];
  isAvailable(): boolean;
  render(request: VideoRenderRequest): Promise<VideoRenderResult>;
}
```

`VideoRenderRequest` carries the scenes, aspect ratio, language, voice, resolved
brand values, timed captions, and per-scene narration audio paths.

| Provider | Modes | Requires |
|---|---|---|
| **ffmpeg (local)** | All except avatar | ffmpeg binary |
| HeyGen | Avatar | `HEYGEN_API_KEY` |
| Synthesia | Avatar | `SYNTHESIA_API_KEY` |

`src/lib/video/registry.ts` selects: the avatar provider for avatar mode when one
is available, the local ffmpeg provider otherwise.

**The architecture is not tied to any avatar vendor.** Adding a provider means
implementing the interface and registering it. Nothing else changes.

Avatar adapters report `isAvailable() === false` without their key, and the
avatar mode is then simply not offered — no dead button, and no pretending a
connector is active without credentials.

### The local renderer matters most

Without any external video credentials, FSW Academy still produces
FSW-branded narrated training video. That is deliberate: an avatar vendor is a
nice option, not a dependency. The local pipeline composes branded scenes,
overlays captions, muxes narration, and outputs a real MP4 using ffmpeg alone.

Degradation is layered and each layer stands on its own:

| Missing | Result |
|---|---|
| Avatar provider | Other modes render normally; avatar mode hidden |
| TTS provider | Video renders with on-screen text and captions, no spoken narration |
| Image provider | Scenes use FSW-branded typographic layouts instead of generated imagery |
| ffmpeg | Scripts, storyboards, narration text, and caption files still generate — no MP4 |

Nothing in that table crashes the application or blocks unrelated features.

---

## SOP-to-video version tracking

A generated video records the exact source version it came from.

`VideoJob.sourceSopId` and `VideoJob.sourceSopVersion` are captured at generation
time, and a `ContentRelationship` row is written:

```
VIDEO/mediaId ──GENERATED_FROM──► SOP/sopId    metadata: { sopVersion: "2.1" }
```

The video therefore displays:

> Video generated from SOP version 2.1

When the SOP later publishes version 2.2, the same relationship makes the
staleness detectable:

> ⚠ This video was generated from SOP version 2.1. The SOP is now at version 2.2.
> The video may be outdated.

This is a **programmatic** fact derived from the relationship graph, not a note
someone has to remember to update. Regeneration is one action from the warning,
and the new render records the new source version.

This closes the loop that makes video sustainable. The usual reason procedure
videos rot is that nobody knows which ones a process change invalidated. Here the
system knows.

---

## Accessibility

Non-negotiable for every video, generated or uploaded:

- **Captions** — VTT generated by the pipeline; required for uploads
- **Transcript** — displayed alongside the player, and indexed for search
- **Keyboard-operable player** — standard controls, visible focus
- **No autoplay** with sound
- **Chapters** for navigation within longer videos
- **Meaning never carried by visuals alone** — narration and on-screen text
  convey the same content, so the video works with sound off and with the screen
  unseen

The generated caption track is a byproduct of the pipeline rather than an
afterthought: the narration text exists before the audio does, so timing captions
is straightforward and they are always accurate to what is said.
