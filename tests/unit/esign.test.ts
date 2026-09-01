import { describe, it, expect } from 'vitest';
import {
  canTransition, statusForEvent, isOutstanding, isOverdue,
  TERMINAL_STATUSES, SIGNATURE_STATUSES,
} from '@/lib/esign/types';
import { parseSignNowEvent, signNowPayloadDigest } from '@/lib/esign/signnow';
import { graphPathFor, chunkRanges, GraphStorageError } from '@/lib/storage-graph';

describe('signature state machine', () => {
  it('walks the happy path', () => {
    expect(canTransition('DRAFT', 'SENT')).toBe(true);
    expect(canTransition('SENT', 'VIEWED')).toBe(true);
    expect(canTransition('VIEWED', 'SIGNED')).toBe(true);
    expect(canTransition('SIGNED', 'STORED')).toBe(true);
  });

  it('allows signing without an intervening view — not every provider reports one', () => {
    expect(canTransition('SENT', 'SIGNED')).toBe(true);
  });

  it('never moves backwards, so an out-of-order webhook cannot un-sign a document', () => {
    expect(canTransition('SIGNED', 'VIEWED')).toBe(false);
    expect(canTransition('SIGNED', 'SENT')).toBe(false);
    expect(canTransition('STORED', 'SIGNED')).toBe(false);
    expect(canTransition('VIEWED', 'SENT')).toBe(false);
  });

  it('keeps SIGNED and STORED distinct, so a failed download cannot look signed', () => {
    // Reaching SIGNED never implies we hold the bytes.
    expect(canTransition('SENT', 'STORED')).toBe(false);
    expect(canTransition('VIEWED', 'STORED')).toBe(false);
    expect(canTransition('SIGNED', 'STORED')).toBe(true);
  });

  it('lets a failed download be retried', () => {
    expect(canTransition('SIGNED', 'FAILED')).toBe(true);
    expect(canTransition('FAILED', 'SIGNED')).toBe(true);
    expect(canTransition('FAILED', 'STORED')).toBe(true);
  });

  it('treats terminal states as terminal', () => {
    for (const status of TERMINAL_STATUSES) {
      for (const target of SIGNATURE_STATUSES) {
        expect(canTransition(status, target)).toBe(false);
      }
    }
  });

  it('cannot decline or expire something already stored', () => {
    expect(canTransition('STORED', 'DECLINED')).toBe(false);
    expect(canTransition('STORED', 'EXPIRED')).toBe(false);
  });

  it('maps provider events to statuses', () => {
    expect(statusForEvent('SENT')).toBe('SENT');
    expect(statusForEvent('VIEWED')).toBe('VIEWED');
    expect(statusForEvent('SIGNED')).toBe('SIGNED');
    expect(statusForEvent('DECLINED')).toBe('DECLINED');
    expect(statusForEvent('EXPIRED')).toBe('EXPIRED');
  });
});

describe('outstanding and overdue', () => {
  const now = new Date('2026-09-10T00:00:00Z');
  const past = new Date('2026-09-01T00:00:00Z');
  const future = new Date('2026-09-20T00:00:00Z');

  it('counts only requests that can still be acted on', () => {
    for (const s of ['DRAFT', 'SENT', 'VIEWED']) expect(isOutstanding(s)).toBe(true);
    for (const s of ['STORED', 'DECLINED', 'EXPIRED', 'CANCELED', 'FAILED', 'SIGNED']) {
      expect(isOutstanding(s)).toBe(false);
    }
  });

  it('is overdue only when outstanding and past due', () => {
    expect(isOverdue('SENT', past, now)).toBe(true);
    expect(isOverdue('SENT', future, now)).toBe(false);
    expect(isOverdue('SENT', null, now)).toBe(false);
    // A signed document is never overdue, whatever its due date said.
    expect(isOverdue('STORED', past, now)).toBe(false);
    expect(isOverdue('DECLINED', past, now)).toBe(false);
  });
});

describe('SignNow webhook parsing', () => {
  const base = {
    event: 'document.complete',
    event_id: 'evt_123',
    timestamp: 1_789_000_000,
    content: { document_id: 'doc_abc', user_id: 'usr_1' },
  };

  it('reads a completion event', () => {
    const parsed = parseSignNowEvent(base);
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe('SIGNED');
    expect(parsed!.providerDocumentId).toBe('doc_abc');
    expect(parsed!.providerEventId).toBe('evt_123');
  });

  it('maps the event vocabulary onto ours', () => {
    expect(parseSignNowEvent({ ...base, event: 'document.open' })!.kind).toBe('VIEWED');
    expect(parseSignNowEvent({ ...base, event: 'document.decline' })!.kind).toBe('DECLINED');
    expect(parseSignNowEvent({ ...base, event: 'invite.sent' })!.kind).toBe('SENT');
    expect(parseSignNowEvent({ ...base, event: 'document.expire' })!.kind).toBe('EXPIRED');
  });

  it('returns null rather than guessing at an unknown event', () => {
    expect(parseSignNowEvent({ ...base, event: 'document.something_new' })).toBeNull();
  });

  it('returns null without a document id — there would be nothing to apply it to', () => {
    expect(parseSignNowEvent({ event: 'document.complete', event_id: 'e1' })).toBeNull();
  });

  it('falls back to a deterministic event id so idempotency still holds', () => {
    const parsed = parseSignNowEvent({ event: 'document.complete', content: { document_id: 'doc_abc' } });
    expect(parsed!.providerEventId).toBe('document.complete:doc_abc');
    // Same delivery twice yields the same key.
    const again = parseSignNowEvent({ event: 'document.complete', content: { document_id: 'doc_abc' } });
    expect(again!.providerEventId).toBe(parsed!.providerEventId);
  });

  it('handles seconds and milliseconds timestamps', () => {
    const seconds = parseSignNowEvent({ ...base, timestamp: 1_789_000_000 })!;
    const millis = parseSignNowEvent({ ...base, timestamp: 1_789_000_000_000 })!;
    expect(seconds.occurredAt.toISOString()).toBe(millis.occurredAt.toISOString());
  });

  it('refuses a non-object body', () => {
    expect(parseSignNowEvent('nope')).toBeNull();
    expect(parseSignNowEvent(null)).toBeNull();
    expect(parseSignNowEvent([1, 2])).toBeNull();
  });
});

describe('webhook payload digest', () => {
  it('records shape, never contents', () => {
    const digest = signNowPayloadDigest({
      event: 'document.complete',
      content: { document_id: 'doc_abc', user_id: 'usr_1', email: 'dana@example.com' },
    });
    const serialized = JSON.stringify(digest);
    expect(serialized).not.toContain('dana@example.com');
    expect(serialized).not.toContain('doc_abc');
    expect(digest.hasDocumentId).toBe(true);
    expect(digest.event).toBe('document.complete');
  });
});

describe('SharePoint path construction', () => {
  it('prefixes the configured root folder and encodes each segment', () => {
    const path = graphPathFor('documents/2026/09/abc123.pdf', 'FSW People');
    expect(path).toBe('FSW%20People/documents/2026/09/abc123.pdf');
  });

  it('refuses traversal', () => {
    expect(() => graphPathFor('../../etc/passwd')).toThrow(GraphStorageError);
    expect(() => graphPathFor('documents/../../secrets.pdf')).toThrow(GraphStorageError);
    expect(() => graphPathFor('documents/./x.pdf')).toThrow(GraphStorageError);
  });

  it('refuses characters SharePoint will not accept, with a usable message', () => {
    expect(() => graphPathFor('documents/bad*name.pdf')).toThrow(/SharePoint will not accept/);
    expect(() => graphPathFor('documents/bad:name.pdf')).toThrow(GraphStorageError);
  });

  it('drops empty segments rather than producing a double slash', () => {
    expect(graphPathFor('documents//x.pdf', 'root')).toBe('root/documents/x.pdf');
  });
});

describe('upload session chunking', () => {
  it('produces inclusive byte ranges covering the whole file', () => {
    const ranges = chunkRanges(10, 4);
    expect(ranges).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 9 },
    ]);
    // Every byte is covered exactly once.
    expect(ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0)).toBe(10);
  });

  it('handles a file that divides evenly', () => {
    const ranges = chunkRanges(8, 4);
    expect(ranges).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
  });

  it('handles a file smaller than one chunk', () => {
    expect(chunkRanges(3, 10)).toEqual([{ start: 0, end: 2 }]);
  });

  it('returns nothing for an empty file', () => {
    expect(chunkRanges(0)).toEqual([]);
  });
});
