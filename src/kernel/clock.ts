/**
 * The clock is injected everywhere (ADR-0029). A test that fails at midnight, or
 * once in a thousand runs, destroys trust in the whole suite.
 */
export interface Clock {
  now(): Date;
  nowMs(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
};

/** Deterministic clock for tests. Advances only when told to. */
export class FixedClock implements Clock {
  #ms: number;

  constructor(start: Date | number = new Date('2026-01-01T00:00:00.000Z')) {
    this.#ms = typeof start === 'number' ? start : start.getTime();
  }

  now(): Date {
    return new Date(this.#ms);
  }

  nowMs(): number {
    return this.#ms;
  }

  advance(ms: number): void {
    this.#ms += ms;
  }

  set(to: Date | number): void {
    this.#ms = typeof to === 'number' ? to : to.getTime();
  }
}
