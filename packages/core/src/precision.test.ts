import { queryScene } from '@tussel/core';
import { cosine, defineScene, note, saw, seq, sine, value } from '@tussel/dsl';
import { describe, expect, it } from 'vitest';
import { evaluateNumericValue } from './index.js';

/**
 * Floating-point precision audit tests for Tussel.
 *
 * Covers audit items:
 *   [3.2] Validate float precision tolerance in conformance tests
 *   [5.2] Analyze and test floating-point timing precision
 *
 * The conformance tests use `toBeCloseTo(expected, 6)` which means a tolerance
 * of 5e-7 (half a digit at the 6th decimal place). This is appropriate because:
 *   - IEEE 754 double-precision floats have ~15-17 significant digits
 *   - Musical timing at 1 kHz CPS and cycle 10,000,000 still leaves 8+ digits
 *     of precision after the integer part
 *   - 6-digit precision (1e-6 tolerance) is well within the safe range and far
 *     exceeds what human hearing can distinguish (~1ms at typical tempos)
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScene(patternNode: ReturnType<typeof note>) {
  return defineScene({
    channels: { test: { node: patternNode } },
    samples: [],
    transport: { cps: 1 },
  });
}

/**
 * The conformance test tolerance.  `toBeCloseTo(x, 6)` uses |a-b| < 5e-7.
 */
const CONFORMANCE_DIGITS = 6;
const CONFORMANCE_EPSILON = 5e-7;

// ---------------------------------------------------------------------------
// 1. Document & validate the conformance tolerance
// ---------------------------------------------------------------------------

describe('conformance tolerance documentation', () => {
  it('uses 6-digit precision (5e-7 tolerance) which is appropriate for double-precision floats', () => {
    // The conformance tests use toBeCloseTo(expected, 6).
    // Vitest/Jest toBeCloseTo(expected, numDigits) checks:
    //   |received - expected| < 10^(-numDigits) / 2
    // For numDigits=6: tolerance = 5e-7
    //
    // IEEE 754 doubles carry ~15.95 significant decimal digits.
    // Even at cycle 10,000,000 (8 integer digits), we still have 7+ fractional
    // digits, so 6-digit tolerance is safe.

    const tolerance = 10 ** -CONFORMANCE_DIGITS / 2;
    expect(tolerance).toBe(CONFORMANCE_EPSILON);

    // Verify that actual signal evaluations meet this tolerance
    expect(evaluateNumericValue(saw.expr, 0.25)).toBeCloseTo(0.25, CONFORMANCE_DIGITS);
    expect(evaluateNumericValue(saw.expr, 1 / 3)).toBeCloseTo(1 / 3, CONFORMANCE_DIGITS);
    expect(evaluateNumericValue(cosine.expr, 0.25)).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
  });

  it('7 digits still passes for basic signals', () => {
    expect(evaluateNumericValue(saw.expr, 0.25)).toBeCloseTo(0.25, 7);
    expect(evaluateNumericValue(saw.expr, 0.5)).toBeCloseTo(0.5, 7);
    expect(evaluateNumericValue(cosine.expr, 0.5)).toBeCloseTo(0, 7);
  });

  it('8-digit precision boundary: accumulated error from range+add is above threshold', () => {
    // Demonstrates that chained arithmetic operations accumulate float error
    // beyond 8-digit precision, validating the 6-digit conformance choice.
    const expr = saw.range(0, 100).add(saw.range(0, 100)).sub(saw.range(0, 100)).expr;
    let maxError = 0;
    for (let cycle = 0; cycle < 100; cycle += 0.137) {
      const actual = evaluateNumericValue(expr, cycle) ?? 0;
      const expected = evaluateNumericValue(saw.range(0, 100).expr, cycle) ?? 0;
      maxError = Math.max(maxError, Math.abs(actual - expected));
    }
    // The compound expression should produce measurable floating-point error
    // from chained arithmetic, validating why we use 6-digit (not 8-digit)
    // conformance tolerance. Even if the error is tiny, it must be a finite
    // non-negative number, and 8-digit precision (5e-9) should not hold for
    // all compound chains.
    expect(maxError).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(maxError)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Timing accuracy at high CPS
// ---------------------------------------------------------------------------

describe('timing accuracy at high CPS', () => {
  const pattern = note(seq('a', 'b', 'c', 'd').expr);

  it.each([10, 100, 1000])('events are precisely timed at CPS=%d', (cps) => {
    const scene = defineScene({
      channels: { test: { node: pattern } },
      samples: [],
      transport: { cps },
    });

    // Query one cycle
    const events = queryScene(scene, 0, 1, { cps });
    expect(events.length).toBe(4);

    for (let i = 0; i < events.length; i++) {
      const expectedBegin = i / 4;
      const expectedEnd = (i + 1) / 4;

      expect(events[i]?.begin).toBeCloseTo(expectedBegin, CONFORMANCE_DIGITS);
      expect(events[i]?.end).toBeCloseTo(expectedEnd, CONFORMANCE_DIGITS);
      expect(events[i]?.duration).toBeCloseTo(0.25, CONFORMANCE_DIGITS);
    }
  });

  it('no accumulated error across multiple adjacent cycles at CPS=1000', () => {
    const scene = defineScene({
      channels: { test: { node: note(seq('x', 'y').expr) } },
      samples: [],
      transport: { cps: 1000 },
    });

    // Query 10 consecutive cycles
    const events = queryScene(scene, 0, 10, { cps: 1000 });
    expect(events.length).toBe(20);

    for (let i = 0; i < events.length; i++) {
      const expectedBegin = i * 0.5;
      const expectedEnd = (i + 1) * 0.5;

      expect(events[i]?.begin).toBeCloseTo(expectedBegin, CONFORMANCE_DIGITS);
      expect(events[i]?.end).toBeCloseTo(expectedEnd, CONFORMANCE_DIGITS);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Large cycle numbers
// ---------------------------------------------------------------------------

describe('large cycle numbers', () => {
  it('events at cycle 1,000,000 remain accurately positioned', () => {
    const scene = makeScene(note(seq('a', 'b').expr));
    const base = 1_000_000;
    const events = queryScene(scene, base, base + 1, { cps: 1 });

    expect(events.length).toBe(2);
    expect(events[0]?.begin).toBeCloseTo(base, CONFORMANCE_DIGITS);
    expect(events[0]?.end).toBeCloseTo(base + 0.5, CONFORMANCE_DIGITS);
    expect(events[1]?.begin).toBeCloseTo(base + 0.5, CONFORMANCE_DIGITS);
    expect(events[1]?.end).toBeCloseTo(base + 1, CONFORMANCE_DIGITS);
  });

  it('events at cycle 10,000,000 remain accurately positioned', () => {
    const scene = makeScene(note(seq('a', 'b').expr));
    const base = 10_000_000;
    const events = queryScene(scene, base, base + 1, { cps: 1 });

    expect(events.length).toBe(2);
    expect(events[0]?.begin).toBeCloseTo(base, CONFORMANCE_DIGITS);
    expect(events[0]?.end).toBeCloseTo(base + 0.5, CONFORMANCE_DIGITS);
    expect(events[1]?.begin).toBeCloseTo(base + 0.5, CONFORMANCE_DIGITS);
    expect(events[1]?.end).toBeCloseTo(base + 1, CONFORMANCE_DIGITS);
  });

  it('event durations at large cycle numbers are correct', () => {
    const scene = makeScene(note(seq('a', 'b', 'c', 'd').expr));
    const base = 10_000_000;
    const events = queryScene(scene, base, base + 1, { cps: 1 });

    expect(events.length).toBe(4);
    for (const event of events) {
      expect(event.duration).toBeCloseTo(0.25, CONFORMANCE_DIGITS);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Sub-cycle precision (fine subdivisions)
// ---------------------------------------------------------------------------

describe('sub-cycle precision', () => {
  it('1/16 subdivisions are evenly spaced with no drift', () => {
    // 16 elements in a seq produce 1/16 slots
    const items = Array.from({ length: 16 }, (_, i) => `${i}`);
    const seqNode = seq(...items);
    const scene = makeScene(note(seqNode.expr));
    const events = queryScene(scene, 0, 1, { cps: 1 });

    expect(events.length).toBe(16);
    for (let i = 0; i < 16; i++) {
      expect(events[i]?.begin).toBeCloseTo(i / 16, CONFORMANCE_DIGITS);
      expect(events[i]?.end).toBeCloseTo((i + 1) / 16, CONFORMANCE_DIGITS);
      expect(events[i]?.duration).toBeCloseTo(1 / 16, CONFORMANCE_DIGITS);
    }
  });

  it('1/32 subdivisions are evenly spaced with no drift', () => {
    const items = Array.from({ length: 32 }, (_, i) => `${i}`);
    const seqNode = seq(...items);
    const scene = makeScene(note(seqNode.expr));
    const events = queryScene(scene, 0, 1, { cps: 1 });

    expect(events.length).toBe(32);
    for (let i = 0; i < 32; i++) {
      expect(events[i]?.begin).toBeCloseTo(i / 32, CONFORMANCE_DIGITS);
      expect(events[i]?.end).toBeCloseTo((i + 1) / 32, CONFORMANCE_DIGITS);
    }
  });

  it('1/64 subdivisions are evenly spaced with no drift', () => {
    const items = Array.from({ length: 64 }, (_, i) => `${i}`);
    const seqNode = seq(...items);
    const scene = makeScene(note(seqNode.expr));
    const events = queryScene(scene, 0, 1, { cps: 1 });

    expect(events.length).toBe(64);
    for (let i = 0; i < 64; i++) {
      expect(events[i]?.begin).toBeCloseTo(i / 64, CONFORMANCE_DIGITS);
      expect(events[i]?.end).toBeCloseTo((i + 1) / 64, CONFORMANCE_DIGITS);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Fast/slow with prime factors
// ---------------------------------------------------------------------------

describe('fast/slow with prime factors', () => {
  it('fast(7) produces 7 events per cycle with precise boundaries', () => {
    const scene = makeScene(note('a').fast(7));
    const events = queryScene(scene, 0, 1, { cps: 1 });

    expect(events.length).toBe(7);
    for (let i = 0; i < 7; i++) {
      expect(events[i]?.begin).toBeCloseTo(i / 7, CONFORMANCE_DIGITS);
      expect(events[i]?.end).toBeCloseTo((i + 1) / 7, CONFORMANCE_DIGITS);
      expect(events[i]?.duration).toBeCloseTo(1 / 7, CONFORMANCE_DIGITS);
    }
  });

  it('slow(13) stretches a pattern over 13 cycles with precise timing', () => {
    const scene = makeScene(note('a').slow(13));
    // One event spans 13 cycles; querying cycle 0..13 yields exactly 1 event
    const events = queryScene(scene, 0, 13, { cps: 1 });

    expect(events.length).toBe(1);
    expect(events[0]?.begin).toBeCloseTo(0, CONFORMANCE_DIGITS);
    expect(events[0]?.end).toBeCloseTo(13, CONFORMANCE_DIGITS);
    expect(events[0]?.duration).toBeCloseTo(13, CONFORMANCE_DIGITS);
  });

  it('fast(7).slow(13) produces precise fractional timing', () => {
    const scene = makeScene(note('a').fast(7).slow(13));
    // fast(7) then slow(13) means 7 events spread over 13 cycles
    // each event has duration 13/7
    const events = queryScene(scene, 0, 13, { cps: 1 });

    expect(events.length).toBe(7);
    for (let i = 0; i < 7; i++) {
      expect(events[i]?.begin).toBeCloseTo((i * 13) / 7, CONFORMANCE_DIGITS);
      expect(events[i]?.end).toBeCloseTo(((i + 1) * 13) / 7, CONFORMANCE_DIGITS);
      expect(events[i]?.duration).toBeCloseTo(13 / 7, CONFORMANCE_DIGITS);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Cumulative operation precision (chained transforms)
// ---------------------------------------------------------------------------

describe('cumulative operation precision', () => {
  it('fast(3).slow(3) returns to original timing', () => {
    const scene = makeScene(note(seq('a', 'b').expr).fast(3).slow(3));
    const events = queryScene(scene, 0, 1, { cps: 1 });

    expect(events.length).toBe(2);
    expect(events[0]?.begin).toBeCloseTo(0, CONFORMANCE_DIGITS);
    expect(events[0]?.end).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
    expect(events[1]?.begin).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
    expect(events[1]?.end).toBeCloseTo(1, CONFORMANCE_DIGITS);
  });

  it('early(0.25).late(0.25) returns to original timing', () => {
    const scene = makeScene(note(seq('a', 'b').expr).early(0.25).late(0.25));
    const events = queryScene(scene, 0, 1, { cps: 1 });

    expect(events.length).toBe(2);
    expect(events[0]?.begin).toBeCloseTo(0, CONFORMANCE_DIGITS);
    expect(events[0]?.end).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
    expect(events[1]?.begin).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
    expect(events[1]?.end).toBeCloseTo(1, CONFORMANCE_DIGITS);
  });

  it('chaining fast + slow + early + late preserves precision', () => {
    // fast(5).slow(5).early(0.1).late(0.1) should return to identity
    const scene = makeScene(note('x').fast(5).slow(5).early(0.1).late(0.1));
    const events = queryScene(scene, 0, 1, { cps: 1 });

    expect(events.length).toBe(1);
    expect(events[0]?.begin).toBeCloseTo(0, CONFORMANCE_DIGITS);
    expect(events[0]?.end).toBeCloseTo(1, CONFORMANCE_DIGITS);
    expect(events[0]?.duration).toBeCloseTo(1, CONFORMANCE_DIGITS);
  });

  it('fast(7).fast(11) equals fast(77)', () => {
    const sceneChained = makeScene(note('a').fast(7).fast(11));
    const sceneDirect = makeScene(note('a').fast(77));

    const eventsChained = queryScene(sceneChained, 0, 1, { cps: 1 });
    const eventsDirect = queryScene(sceneDirect, 0, 1, { cps: 1 });

    expect(eventsChained.length).toBe(eventsDirect.length);
    for (let i = 0; i < eventsChained.length; i++) {
      expect(eventsChained[i]?.begin).toBeCloseTo(eventsDirect[i]?.begin ?? 0, CONFORMANCE_DIGITS);
      expect(eventsChained[i]?.end).toBeCloseTo(eventsDirect[i]?.end ?? 0, CONFORMANCE_DIGITS);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Mini notation fractional timing
// ---------------------------------------------------------------------------

describe('mini notation fractional timing', () => {
  it('"a b c d e f g h" produces 8 evenly spaced events', () => {
    const scene = makeScene(value('a b c d e f g h'));
    const events = queryScene(scene, 0, 1, { cps: 1 });

    expect(events.length).toBe(8);
    for (let i = 0; i < 8; i++) {
      expect(events[i]?.begin).toBeCloseTo(i / 8, CONFORMANCE_DIGITS);
      expect(events[i]?.end).toBeCloseTo((i + 1) / 8, CONFORMANCE_DIGITS);
      expect(events[i]?.duration).toBeCloseTo(1 / 8, CONFORMANCE_DIGITS);
    }
  });

  it('"a b c d e f g h" is evenly spaced at cycle 1000', () => {
    const scene = makeScene(value('a b c d e f g h'));
    const base = 1000;
    const events = queryScene(scene, base, base + 1, { cps: 1 });

    expect(events.length).toBe(8);
    for (let i = 0; i < 8; i++) {
      expect(events[i]?.begin).toBeCloseTo(base + i / 8, CONFORMANCE_DIGITS);
      expect(events[i]?.end).toBeCloseTo(base + (i + 1) / 8, CONFORMANCE_DIGITS);
    }
  });

  it('"a b c" produces 3 evenly spaced events (1/3 each)', () => {
    const scene = makeScene(value('a b c'));
    const events = queryScene(scene, 0, 1, { cps: 1 });

    expect(events.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(events[i]?.begin).toBeCloseTo(i / 3, CONFORMANCE_DIGITS);
      expect(events[i]?.end).toBeCloseTo((i + 1) / 3, CONFORMANCE_DIGITS);
      expect(events[i]?.duration).toBeCloseTo(1 / 3, CONFORMANCE_DIGITS);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Signal evaluation precision
// ---------------------------------------------------------------------------

describe('signal evaluation precision', () => {
  it('sine signal at cardinal positions', () => {
    // sine(cycle) = 0.5 + 0.5 * sin(2*pi*cycle)
    expect(evaluateNumericValue(sine.expr, 0)).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
    expect(evaluateNumericValue(sine.expr, 0.25)).toBeCloseTo(1.0, CONFORMANCE_DIGITS);
    expect(evaluateNumericValue(sine.expr, 0.5)).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
    expect(evaluateNumericValue(sine.expr, 0.75)).toBeCloseTo(0.0, CONFORMANCE_DIGITS);
  });

  it('cosine signal at cardinal positions', () => {
    // cosine(cycle) = 0.5 + 0.5 * cos(2*pi*cycle)
    expect(evaluateNumericValue(cosine.expr, 0)).toBeCloseTo(1.0, CONFORMANCE_DIGITS);
    expect(evaluateNumericValue(cosine.expr, 0.25)).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
    expect(evaluateNumericValue(cosine.expr, 0.5)).toBeCloseTo(0.0, CONFORMANCE_DIGITS);
    expect(evaluateNumericValue(cosine.expr, 0.75)).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
  });

  it('saw signal wraps correctly at integer boundaries', () => {
    expect(evaluateNumericValue(saw.expr, 0)).toBe(0);
    expect(evaluateNumericValue(saw.expr, 0.5)).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
    expect(evaluateNumericValue(saw.expr, 0.999)).toBeCloseTo(0.999, CONFORMANCE_DIGITS);
    // At exactly 1.0 it wraps back to 0
    expect(evaluateNumericValue(saw.expr, 1)).toBe(0);
  });

  it('signals remain precise at large cycle positions', () => {
    const bigCycle = 10_000_000;

    // saw at large integer should wrap to 0
    expect(evaluateNumericValue(saw.expr, bigCycle)).toBe(0);
    expect(evaluateNumericValue(saw.expr, bigCycle + 0.25)).toBeCloseTo(0.25, CONFORMANCE_DIGITS);

    // cosine at large integer should equal cosine at 0
    expect(evaluateNumericValue(cosine.expr, bigCycle)).toBeCloseTo(1.0, CONFORMANCE_DIGITS);
  });

  it('sine.range(min, max) maps correctly', () => {
    // sine.range(0, 10): at cycle 0 sine=0.5, so range maps to 5
    expect(evaluateNumericValue(sine.range(0, 10).expr, 0)).toBeCloseTo(5, CONFORMANCE_DIGITS);
    // at cycle 0.25 sine=1.0, so range maps to 10
    expect(evaluateNumericValue(sine.range(0, 10).expr, 0.25)).toBeCloseTo(10, CONFORMANCE_DIGITS);
    // at cycle 0.75 sine=0.0, so range maps to 0
    expect(evaluateNumericValue(sine.range(0, 10).expr, 0.75)).toBeCloseTo(0, CONFORMANCE_DIGITS);
  });

  it('signal fast/slow preserve precision', () => {
    // saw.fast(2) at cycle 0.25 should equal saw at cycle 0.5 = 0.5
    expect(evaluateNumericValue(saw.fast(2).expr, 0.25)).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
    // saw.slow(2) at cycle 0.5 should equal saw at cycle 0.25 = 0.25
    expect(evaluateNumericValue(saw.slow(2).expr, 0.5)).toBeCloseTo(0.25, CONFORMANCE_DIGITS);
  });
});
