/**
 * Transcript ingestion.
 *
 * This platform does not transcribe audio, and does not pretend to. Zoom,
 * Meet and Teams all produce a transcript already; taking theirs is more
 * accurate than anything a bolted-on model would produce, costs nothing, and
 * means the audio does not have to be shipped to a third party at all.
 *
 * So: parse what a meeting tool gives you. WebVTT, SRT, or plain text with
 * speaker labels.
 */

export interface Segment {
  orderIndex: number;
  speakerLabel: string | null;
  startMs: number;
  endMs: number;
  text: string;
}

/** "00:01:23.456" or "00:01:23,456" or "01:23.456" → milliseconds. */
export function parseTimestamp(value: string): number | null {
  const m = value
    .trim()
    .match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return null;
  const [, h, min, sec, frac] = m;
  return (
    Number(h ?? 0) * 3600_000 +
    Number(min) * 60_000 +
    Number(sec) * 1000 +
    Number(frac.padEnd(3, "0"))
  );
}

const CUE_LINE = /^(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/;
/** "Ana Cruz: I rewrote the import" — a label, then a colon. */
const SPEAKER_PREFIX = /^([A-Za-z][\w .'-]{0,40}):\s*(.*)$/;

/**
 * Parse WebVTT or SRT.
 *
 * The two formats differ in a header line, a comma instead of a dot in
 * timestamps, and cue numbering — all of which this tolerates rather than
 * asking the user which one they have.
 */
export function parseCueFormat(input: string): Segment[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const segments: Segment[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line === "WEBVTT" || line.startsWith("NOTE") || /^\d+$/.test(line)) {
      i++;
      continue;
    }
    const cue = line.match(CUE_LINE);
    if (!cue) {
      i++;
      continue;
    }
    const startMs = parseTimestamp(cue[1]);
    const endMs = parseTimestamp(cue[2]);
    i++;
    if (startMs === null || endMs === null) continue;

    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i].trim());
      i++;
    }
    if (textLines.length === 0) continue;

    // Strip the cue-level markup some tools emit, then look for a speaker.
    const raw = textLines
      .join(" ")
      .replace(/<v\s+([^>]+)>/g, "$1: ")
      .replace(/<\/?[^>]+>/g, "")
      .trim();
    const withSpeaker = raw.match(SPEAKER_PREFIX);

    segments.push({
      orderIndex: segments.length,
      speakerLabel: withSpeaker ? withSpeaker[1].trim() : null,
      startMs,
      endMs: Math.max(endMs, startMs),
      text: (withSpeaker ? withSpeaker[2] : raw).trim(),
    });
  }
  return segments.filter((s) => s.text.length > 0);
}

/**
 * Parse a plain-text transcript.
 *
 * No timestamps to work with, so segments get a nominal position from their
 * order. Evidence quotes then carry a position rather than a real time, and
 * the UI says so — an offset presented as a timestamp would send someone
 * scrubbing to the wrong part of the audio.
 */
export function parsePlainText(input: string): Segment[] {
  const paragraphs = input
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n|\n(?=[A-Za-z][\w .'-]{0,40}:)/)
    .map((p) => p.trim())
    .filter(Boolean);

  return paragraphs.map((p, index) => {
    const withSpeaker = p.match(SPEAKER_PREFIX);
    return {
      orderIndex: index,
      speakerLabel: withSpeaker ? withSpeaker[1].trim() : null,
      startMs: -1,
      endMs: -1,
      text: (withSpeaker ? withSpeaker[2] : p).replace(/\s+/g, " ").trim(),
    };
  });
}

export type TranscriptFormat = "vtt" | "srt" | "text";

export function detectFormat(input: string): TranscriptFormat {
  const head = input.slice(0, 4000);
  if (/^\ufeff?WEBVTT/.test(head)) return "vtt";

  // Line by line: CUE_LINE is anchored, so testing it against a whole
  // multi-line document never matches and every cue format looks like prose.
  const cue = head
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.includes("-->") && CUE_LINE.test(l));
  if (!cue) return "text";

  // SRT writes milliseconds after a comma, WebVTT after a dot. Look at the
  // cue line itself: punctuation anywhere else in the file says nothing.
  return /\d,\d/.test(cue) ? "srt" : "vtt";
}

export function parseTranscript(input: string): {
  segments: Segment[];
  format: TranscriptFormat;
  hasTimestamps: boolean;
} {
  const format = detectFormat(input);
  const segments = format === "text" ? parsePlainText(input) : parseCueFormat(input);
  return {
    segments,
    format,
    hasTimestamps: segments.some((s) => s.startMs >= 0),
  };
}

/** Total spoken time, when there are timestamps to measure it with. */
export function transcriptDurationSeconds(segments: Segment[]): number | null {
  const timed = segments.filter((s) => s.endMs >= 0);
  if (timed.length === 0) return null;
  return Math.round(Math.max(...timed.map((s) => s.endMs)) / 1000);
}

/** Render for the model, with positions it can cite back. */
export function transcriptForPrompt(segments: Segment[], maxChars = 120_000): string {
  const lines: string[] = [];
  let used = 0;
  for (const s of segments) {
    const stamp = s.startMs >= 0 ? msToClock(s.startMs) : `#${s.orderIndex}`;
    const who = s.speakerLabel ? `${s.speakerLabel}` : "Unknown speaker";
    const line = `[${stamp}] ${who}: ${s.text}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

export function msToClock(ms: number): string {
  if (ms < 0) return "—";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/**
 * Find where a quote actually appears.
 *
 * The model is asked to quote verbatim and to give the position, but a stray
 * space or a smart quote is enough to make the position wrong. Locating the
 * text in the transcript is what makes a quote checkable — and a quote that
 * cannot be located is one this platform refuses to show, because an
 * unlocatable quote attributed to a candidate is a fabrication.
 */
export function locateQuote(
  segments: Segment[],
  quote: string,
): { startMs: number; endMs: number; orderIndex: number } | null {
  const needle = normalize(quote);
  if (needle.length < 8) return null;

  for (const s of segments) {
    if (normalize(s.text).includes(needle)) {
      return { startMs: s.startMs, endMs: s.endMs, orderIndex: s.orderIndex };
    }
  }
  // A quote can legitimately run across a pause and therefore across segments.
  for (let i = 0; i < segments.length - 1; i++) {
    for (let span = 2; span <= 4 && i + span <= segments.length; span++) {
      const window = segments.slice(i, i + span);
      if (normalize(window.map((s) => s.text).join(" ")).includes(needle)) {
        return {
          startMs: window[0].startMs,
          endMs: window[window.length - 1].endMs,
          orderIndex: window[0].orderIndex,
        };
      }
    }
  }
  return null;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9'" ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
