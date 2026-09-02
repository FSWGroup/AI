# FSW Talent Scout — Recording Architecture & Privacy Protections

## What is recorded, and why

- **Video only.** Audio is never requested (`getUserMedia({ video: true,
  audio: false })`) and never recorded.
- The sole purpose is **assessment integrity**: giving a human reviewer the
  ability to check, when objective events warrant it, that the named
  candidate completed the assessment without assistance.
- Recording starts only after the candidate has read the recording notice
  and affirmatively consented (the checkbox is never pre-checked), begins
  immediately before the substantive assessment, shows a persistent
  "🔴 Recording" indicator, and stops at completion or exit.

## What is never done — enforced by absence

There is **no code anywhere in this repository** that performs, and no
dependency capable of:

- face recognition, face matching, or identity matching from face geometry
- emotion or "attention" analysis; gaze scoring
- age, gender, race/ethnicity, or disability inference
- attractiveness or appearance scoring; personality inference from video

The recording pipeline captures bytes from `MediaRecorder`, uploads them,
and plays them back to authorized humans. Nothing decodes or analyzes
frames. Recording data plays **no part in any score**: not aptitude scores,
not behavioral scores, not job-fit results, and it never rejects anyone.
Only objective, non-video events (tab switches, disconnects, camera
interruptions) feed the human-facing integrity summary.

Even human reviewers see this reminder before playback, and it is embedded
in the report appendix:

> Review this recording only for assessment-integrity concerns. Do not
> evaluate appearance or any actual or perceived protected characteristic.

## Consent

Before camera access is requested, the candidate sees the full notice
(purpose, video-only, not scored, no biometric analysis, who can view,
retention, privacy contact) and must check an unchecked consent box. The
`ConsentRecord` row stores the notice version, consent text, timestamp, and
request metadata. Camera-exempt attempts (an HR-approved accommodation) skip
recording entirely.

## Technical pipeline

1. `MediaRecorder` (VP9/VP8 WebM preferred, MP4 fallback) emits ~10-second
   chunks at a modest bitrate — an hour of video never sits in memory.
2. Chunks queue in **IndexedDB** (surviving refreshes and brief offline
   periods) and upload with exponential-backoff retry.
3. Each chunk uploads **directly to object storage** via a short-lived
   signed URL (S3 presigned PUT in production; an HMAC-token route for the
   local dev provider). Large media never flows through application JSON
   endpoints.
4. The server records a manifest per chunk (sequence, size, checksum,
   timestamps, upload status) and verifies object existence before marking
   a chunk uploaded. Finalization compares uploaded chunks against the
   client-declared count → `FINALIZED` or `INCOMPLETE`.
5. Object layout: `assessment-recordings/{attemptId}/{sessionId}/{seq}.webm`
   in a **private** bucket. No public URLs exist.

Camera interruptions (track ended/muted, device loss) are logged as
objective events (`CAMERA_INTERRUPTED` / `CAMERA_RESTORED`), close the
current recording session honestly, and prompt the candidate to reconnect —
after a grace period a blocking overlay appears, but **section timers are
never paused or reset** by camera state.

## Access control and audit

- Playback requires a role in `OrgSettings.recordingAccessRoles` —
  **default: SUPER_ADMIN and HR_ADMIN only** (hiring managers and viewers
  are denied by default; the allowlist is configurable in Settings).
- Job-scoped roles are additionally checked against their assigned job
  profiles.
- Every playback issuance and every deletion writes an `AuditEvent`
  (append-only). Playback URLs expire after ~5 minutes.
- Deletion removes both the database manifest and the storage objects, and
  is blocked while a matching legal hold is active.

## Retention

Recording retention is a configurable policy (`WEBCAM_RECORDINGS`), applied
by the scheduled retention job, which deletes storage objects and manifests
together, skips anything under legal hold, and logs a summary to the audit
trail. In production, webcam invitations are refused until a recording
retention policy, the privacy notice, object storage, and HTTPS are
configured.
