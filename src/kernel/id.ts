/**
 * Canonical identifiers: UUIDv7 (ADR-0004, RFC 9562).
 *
 * Generated in the application so an aggregate has its identity before it reaches
 * the database and can appear in an event emitted in the same transaction.
 *
 * Layout (RFC 9562 §5.7, with the "replace leftmost random bits with an increased
 * clock precision" monotonicity method):
 *
 *   bits   0..47   unix timestamp in milliseconds, big endian
 *   bits  48..51   version (0111)
 *   bits  52..63   12-bit counter, incremented within a millisecond
 *   bits  64..65   variant (10)
 *   bits  66..127  random
 *
 * The counter makes identifiers generated inside the same millisecond strictly
 * ordered, which keeps B-tree insert locality tight under burst inserts.
 */
import { randomFillSync } from 'node:crypto';
import type { Clock } from './clock.js';
import { systemClock } from './clock.js';

/** A canonical FSW identifier. Branded so a raw string cannot be passed by accident. */
export type Uuid = string & { readonly __brand: 'Uuid' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MAX_COUNTER = 0x0fff;

export interface IdGenerator {
  next(): Uuid;
}

export function createIdGenerator(
  clock: Clock = systemClock,
  fillRandom: (buffer: Uint8Array) => void = (b) => {
    randomFillSync(b);
  },
): IdGenerator {
  let lastMs = -1;
  let counter = 0;

  return {
    next(): Uuid {
      let ms = clock.nowMs();

      if (ms === lastMs) {
        counter += 1;
        if (counter > MAX_COUNTER) {
          // More than 4096 identifiers in one millisecond. Rather than risk a
          // duplicate or a non-monotonic value, borrow from the next millisecond.
          // Identifiers stay unique and ordered; the timestamp is at most a few
          // milliseconds ahead, which no consumer relies on.
          ms = lastMs + 1;
          lastMs = ms;
          counter = 0;
        }
      } else if (ms < lastMs) {
        // The wall clock moved backwards (NTP correction). Keep monotonicity by
        // staying on the last observed millisecond.
        ms = lastMs;
        counter += 1;
        if (counter > MAX_COUNTER) {
          ms = lastMs + 1;
          lastMs = ms;
          counter = 0;
        }
      } else {
        lastMs = ms;
        counter = 0;
      }

      const bytes = new Uint8Array(16);
      fillRandom(bytes);

      // 48-bit timestamp.
      bytes[0] = (ms / 2 ** 40) & 0xff;
      bytes[1] = (ms / 2 ** 32) & 0xff;
      bytes[2] = (ms / 2 ** 24) & 0xff;
      bytes[3] = (ms / 2 ** 16) & 0xff;
      bytes[4] = (ms / 2 ** 8) & 0xff;
      bytes[5] = ms & 0xff;

      // Version 7 plus the high 4 bits of the counter.
      bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
      bytes[7] = counter & 0xff;

      // RFC 4122 variant, preserving the random low bits.
      bytes[8] = 0x80 | (bytes[8]! & 0x3f);

      return format(bytes);
    },
  };
}

function format(bytes: Uint8Array): Uuid {
  let hex = '';
  for (let i = 0; i < 16; i += 1) hex += bytes[i]!.toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20, 32)}` as Uuid;
}

/** Process-wide generator for code that is not in a test's injection path. */
export const ids: IdGenerator = createIdGenerator();

export function isUuid(value: string): value is Uuid {
  return UUID_PATTERN.test(value);
}

export function asUuid(value: string): Uuid {
  if (!isUuid(value)) throw new TypeError(`Not a UUID: ${value}`);
  return value;
}

/** The millisecond a UUIDv7 encodes. Useful for diagnostics, never for ordering logic. */
export function uuidV7Timestamp(value: Uuid): Date {
  const hex = value.replace(/-/g, '').slice(0, 12);
  return new Date(Number.parseInt(hex, 16));
}
