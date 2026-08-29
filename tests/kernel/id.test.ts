import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createIdGenerator,
  isUuid,
  asUuid,
  uuidV7Timestamp,
} from '../../src/kernel/id.js';
import { FixedClock } from '../../src/kernel/clock.js';

describe('UUIDv7 (ADR-0004)', () => {
  it('produces well-formed identifiers with version 7 and the RFC 4122 variant', () => {
    const ids = createIdGenerator();
    for (let i = 0; i < 1000; i += 1) {
      const id = ids.next();
      expect(isUuid(id)).toBe(true);
      expect(id[14]).toBe('7');
      expect(['8', '9', 'a', 'b']).toContain(id[19]);
    }
  });

  it('is unique across a large burst', () => {
    const ids = createIdGenerator();
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i += 1) seen.add(ids.next());
    expect(seen.size).toBe(100_000);
  });

  it('is strictly increasing, including within a single millisecond', () => {
    // The clock never advances here, so every identifier lands in the same
    // millisecond and ordering depends entirely on the 12-bit counter.
    const clock = new FixedClock();
    const ids = createIdGenerator(clock);
    let previous = ids.next();
    for (let i = 0; i < 4000; i += 1) {
      const next = ids.next();
      expect(next > previous).toBe(true);
      previous = next;
    }
  });

  it('stays monotonic when the counter overflows within a millisecond', () => {
    const clock = new FixedClock();
    const ids = createIdGenerator(clock);
    let previous = ids.next();
    // Well past the 4096 the counter can hold, forcing the borrow-a-millisecond path.
    for (let i = 0; i < 20_000; i += 1) {
      const next = ids.next();
      expect(next > previous).toBe(true);
      previous = next;
    }
  });

  it('stays monotonic when the wall clock moves backwards', () => {
    const clock = new FixedClock(new Date('2026-06-01T12:00:00.000Z'));
    const ids = createIdGenerator(clock);
    const before = ids.next();
    clock.advance(-5000); // an NTP correction
    const after = ids.next();
    expect(after > before).toBe(true);
  });

  it('orders by time across milliseconds', () => {
    const clock = new FixedClock();
    const ids = createIdGenerator(clock);
    const generated: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      generated.push(ids.next());
      clock.advance(1);
    }
    expect([...generated].sort()).toEqual(generated);
  });

  it('encodes the generating millisecond', () => {
    const when = new Date('2026-08-29T14:30:00.000Z');
    const ids = createIdGenerator(new FixedClock(when));
    expect(uuidV7Timestamp(ids.next()).getTime()).toBe(when.getTime());
  });

  it('rejects anything that is not a UUID', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        if (isUuid(value)) return; // fast-check will not generate one, but be exact
        expect(() => asUuid(value)).toThrow(TypeError);
      }),
    );
  });
});
