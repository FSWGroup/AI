/**
 * WebM chunk assembly for recording playback.
 *
 * MediaRecorder with a timeslice emits chunks where ONLY the first chunk
 * carries the WebM/EBML header (EBML header + Segment info + Tracks). Every
 * later chunk is a bare sequence of Clusters, which no player can open on
 * its own. Playing chunks individually therefore shows only the first
 * segment of the recording.
 *
 * This module reassembles them:
 *   - concatenating every chunk in sequence order reproduces the exact byte
 *     stream MediaRecorder would have produced without a timeslice, so the
 *     whole recording plays;
 *   - for "jump to a later point", the header prefix (everything in chunk 0
 *     before the first Cluster) is spliced onto the chunks from that point
 *     on, producing a valid, playable stream that starts there.
 *
 * Nothing here decodes, analyzes, or inspects the video content itself —
 * only container framing. See docs/RECORDING-PRIVACY.md.
 */

/** EBML element ID for a Cluster: 0x1F43B675. */
const CLUSTER_ID = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);

/** EBML magic bytes that must start a valid WebM file. */
const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

export function hasWebmHeader(chunk: Buffer): boolean {
  return chunk.subarray(0, 4).equals(EBML_MAGIC);
}

/**
 * Everything in the first chunk before its first Cluster: the initialization
 * segment a player needs to decode any later cluster. Returns null when the
 * chunk isn't a header chunk or has no cluster boundary.
 */
export function extractInitSegment(firstChunk: Buffer): Buffer | null {
  if (!hasWebmHeader(firstChunk)) return null;
  const idx = firstChunk.indexOf(CLUSTER_ID);
  if (idx <= 0) return null;
  return firstChunk.subarray(0, idx);
}

export interface ChunkRef {
  sequence: number;
  objectKey: string;
  sizeBytes: number;
}

/** One piece of the virtual file: either the init segment or a whole chunk. */
export interface StreamPart {
  kind: "init" | "chunk";
  objectKey?: string;
  /** Byte length of this part within the virtual file. */
  length: number;
  /** Start offset of this part within the virtual file. */
  offset: number;
}

/**
 * Lay out the virtual file for a playback request.
 *
 * fromSequence 0 (or the first available chunk) => plain concatenation, since
 * chunk 0 already contains the header. Any later start => the init segment is
 * prepended so the stream is independently playable.
 */
export function planStream(
  chunks: ChunkRef[],
  fromSequence: number,
  initSegmentLength: number,
): { parts: StreamPart[]; totalLength: number } {
  const ordered = [...chunks].sort((a, b) => a.sequence - b.sequence);
  if (ordered.length === 0) return { parts: [], totalLength: 0 };

  const first = ordered[0].sequence;
  const selected = ordered.filter((c) => c.sequence >= fromSequence);
  if (selected.length === 0) return { parts: [], totalLength: 0 };

  const needsInit = selected[0].sequence !== first;
  const parts: StreamPart[] = [];
  let offset = 0;

  if (needsInit && initSegmentLength > 0) {
    parts.push({ kind: "init", length: initSegmentLength, offset });
    offset += initSegmentLength;
  }
  for (const c of selected) {
    parts.push({
      kind: "chunk",
      objectKey: c.objectKey,
      length: c.sizeBytes,
      offset,
    });
    offset += c.sizeBytes;
  }
  return { parts, totalLength: offset };
}

/** Parse an HTTP Range header against a known total length. */
export function parseRange(
  header: string | null,
  totalLength: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, startStr, endStr] = m;

  let start: number;
  let end: number;
  if (startStr === "") {
    // Suffix range: last N bytes.
    const suffix = parseInt(endStr, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, totalLength - suffix);
    end = totalLength - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === "" ? totalLength - 1 : parseInt(endStr, 10);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start >= totalLength || end < start) return null;
  return { start, end: Math.min(end, totalLength - 1) };
}

/** The parts overlapping [start, end], with the slice needed from each. */
export function partsForRange(
  parts: StreamPart[],
  start: number,
  end: number,
): { part: StreamPart; sliceStart: number; sliceEnd: number }[] {
  const out: { part: StreamPart; sliceStart: number; sliceEnd: number }[] = [];
  for (const part of parts) {
    const partEnd = part.offset + part.length - 1;
    if (partEnd < start || part.offset > end) continue;
    out.push({
      part,
      sliceStart: Math.max(0, start - part.offset),
      sliceEnd: Math.min(part.length - 1, end - part.offset),
    });
  }
  return out;
}
