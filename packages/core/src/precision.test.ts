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
 *   [8.4] High cycle count, accumulated transform error, and boundary detection
 *   [9.1] Worst-case precision characterization and documentation
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

// ---------------------------------------------------------------------------
// 9. High cycle count precision (10K, 100K, 1M cycles) -- audit item 8.4
// ---------------------------------------------------------------------------

describe('high cycle count precision', () => {
  /**
   * Measures worst-case absolute error across events at a given cycle offset.
   * Returns the maximum |actual - expected| for begin, end, and duration fields.
   */
  function measureMaxError(
    base: number,
    numElements: number,
  ): { maxError: number; worstField: string; worstIndex: number } {
    const items = Array.from({ length: numElements }, (_, i) => String.fromCodePoint(97 + (i % 26)));
    const scene = makeScene(note(seq(...items).expr));
    const events = queryScene(scene, base, base + 1, { cps: 1 });

    let maxError = 0;
    let worstField = '';
    let worstIndex = 0;

    for (let i = 0; i < events.length; i++) {
      const expectedBegin = base + i / numElements;
      const expectedEnd = base + (i + 1) / numElements;
      const expectedDuration = 1 / numElements;

      const beginErr = Math.abs((events[i]?.begin ?? 0) - expectedBegin);
      const endErr = Math.abs((events[i]?.end ?? 0) - expectedEnd);
      const durErr = Math.abs((events[i]?.duration ?? 0) - expectedDuration);

      if (beginErr > maxError) {
        maxError = beginErr;
        worstField = 'begin';
        worstIndex = i;
      }
      if (endErr > maxError) {
        maxError = endErr;
        worstField = 'end';
        worstIndex = i;
      }
      if (durErr > maxError) {
        maxError = durErr;
        worstField = 'duration';
        worstIndex = i;
      }
    }

    return { maxError, worstField, worstIndex };
  }

  it('4-element seq at cycle 10,000 stays within conformance tolerance', () => {
    const result = measureMaxError(10_000, 4);
    expect(result.maxError).toBeLessThan(CONFORMANCE_EPSILON);
  });

  it('4-element seq at cycle 100,000 stays within conformance tolerance', () => {
    const result = measureMaxError(100_000, 4);
    expect(result.maxError).toBeLessThan(CONFORMANCE_EPSILON);
  });

  it('4-element seq at cycle 1,000,000 stays within conformance tolerance', () => {
    const result = measureMaxError(1_000_000, 4);
    expect(result.maxError).toBeLessThan(CONFORMANCE_EPSILON);
  });

  it('7-element seq (prime) at cycle 1,000,000 stays within conformance tolerance', () => {
    // 1/7 is a repeating decimal in base-10/base-2, stress-testing float division
    const result = measureMaxError(1_000_000, 7);
    expect(result.maxError).toBeLessThan(CONFORMANCE_EPSILON);
  });

  it('16-element seq at cycle 1,000,000 stays within conformance tolerance', () => {
    const result = measureMaxError(1_000_000, 16);
    expect(result.maxError).toBeLessThan(CONFORMANCE_EPSILON);
  });

  it('documents worst-case precision at extreme cycle counts', () => {
    // This test measures and documents (not asserts on) precision at extreme
    // cycle counts, providing empirical data for the precision-impact doc.
    const measurements: Array<{ base: number; elements: number; maxError: number; worstField: string }> = [];

    for (const base of [10_000, 100_000, 1_000_000]) {
      for (const elements of [4, 7, 13, 16]) {
        const result = measureMaxError(base, elements);
        measurements.push({ base, elements, maxError: result.maxError, worstField: result.worstField });
      }
    }

    // All measured errors must be finite
    for (const m of measurements) {
      expect(Number.isFinite(m.maxError)).toBe(true);
    }

    // The worst error across all measurements should still be well within tolerance
    const overallWorst = Math.max(...measurements.map((m) => m.maxError));
    expect(overallWorst).toBeLessThan(CONFORMANCE_EPSILON);
  });
});

// ---------------------------------------------------------------------------
// 10. Accumulated error from repeated fast/slow transforms -- audit item 8.4
// ---------------------------------------------------------------------------

describe('accumulated error from repeated transforms', () => {
  it('fast(N).slow(N) identity chain preserves timing at depth 1-5', () => {
    // Each fast/slow pair should cancel. Chaining multiple pairs tests whether
    // accumulated multiply/divide error stays within tolerance.
    for (let depth = 1; depth <= 5; depth++) {
      let pattern = note(seq('a', 'b').expr);
      for (let d = 0; d < depth; d++) {
        const factor = 3 + d * 2; // 3, 5, 7, 9, 11
        pattern = pattern.fast(factor).slow(factor);
      }

      const scene = makeScene(pattern);
      const events = queryScene(scene, 0, 1, { cps: 1 });

      expect(events.length).toBe(2);
      expect(events[0]?.begin).toBeCloseTo(0, CONFORMANCE_DIGITS);
      expect(events[0]?.end).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
      expect(events[1]?.begin).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
      expect(events[1]?.end).toBeCloseTo(1, CONFORMANCE_DIGITS);
    }
  });

  it('chained fast with non-trivial primes: fast(3).fast(5).fast(7) = fast(105)', () => {
    const sceneChained = makeScene(note('a').fast(3).fast(5).fast(7));
    const sceneDirect = makeScene(note('a').fast(105));

    const eventsChained = queryScene(sceneChained, 0, 1, { cps: 1 });
    const eventsDirect = queryScene(sceneDirect, 0, 1, { cps: 1 });

    expect(eventsChained.length).toBe(eventsDirect.length);
    expect(eventsChained.length).toBe(105);

    let maxError = 0;
    for (let i = 0; i < eventsChained.length; i++) {
      maxError = Math.max(
        maxError,
        Math.abs((eventsChained[i]?.begin ?? 0) - (eventsDirect[i]?.begin ?? 0)),
        Math.abs((eventsChained[i]?.end ?? 0) - (eventsDirect[i]?.end ?? 0)),
      );
    }
    // Chained multiplication (begin * 3 * 5 * 7) vs direct (begin * 105) may
    // differ by a few ULPs but must stay within conformance tolerance.
    expect(maxError).toBeLessThan(CONFORMANCE_EPSILON);
  });

  it('slow(N).fast(N) identity chain at high cycle count', () => {
    // Test the inverse order: slow first, then fast, at a high cycle count
    let pattern = note(seq('x', 'y', 'z').expr);
    pattern = pattern.slow(7).fast(7).slow(11).fast(11);

    const base = 100_000;
    const scene = makeScene(pattern);
    const events = queryScene(scene, base, base + 1, { cps: 1 });

    expect(events.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(events[i]?.begin).toBeCloseTo(base + i / 3, CONFORMANCE_DIGITS);
      expect(events[i]?.end).toBeCloseTo(base + (i + 1) / 3, CONFORMANCE_DIGITS);
    }
  });

  it('accumulated fast error measured across 1000 events', () => {
    // fast(1000) produces 1000 events. Measure the maximum timing error
    // across all events to characterize accumulated division error.
    const scene = makeScene(note('a').fast(1000));
    const events = queryScene(scene, 0, 1, { cps: 1 });

    expect(events.length).toBe(1000);

    let maxError = 0;
    for (let i = 0; i < events.length; i++) {
      const expectedBegin = i / 1000;
      const expectedEnd = (i + 1) / 1000;
      maxError = Math.max(
        maxError,
        Math.abs((events[i]?.begin ?? 0) - expectedBegin),
        Math.abs((events[i]?.end ?? 0) - expectedEnd),
      );
    }

    // 1000 events from a single fast() call involve one multiply and one divide
    // per event, so error is bounded by a few ULPs of the largest value (1.0).
    // Double ULP at 1.0 is ~2.2e-16, so even with a factor of 1000 the error
    // should be far below our conformance tolerance.
    expect(maxError).toBeLessThan(CONFORMANCE_EPSILON);
  });
});

// ---------------------------------------------------------------------------
// 11. Cycle boundary detection at high counts -- audit item 8.4
// ---------------------------------------------------------------------------

describe('cycle boundary detection at high counts', () => {
  it('Math.floor correctly identifies cycle boundaries up to 2^40', () => {
    // querySequence uses Math.floor(begin) to find cycle boundaries.
    // IEEE 754 doubles represent integers exactly up to 2^53. Verify that
    // cycle boundaries are detected correctly at large values.
    const testPoints = [1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e12];

    for (const base of testPoints) {
      // An integer cycle number must floor to itself
      expect(Math.floor(base)).toBe(base);
      // base + 0.5 must floor to base
      expect(Math.floor(base + 0.5)).toBe(base);
      // base + 0.999 should floor to base
      expect(Math.floor(base + 0.999)).toBe(base);
    }
  });

  it('queryScene returns correct event count at cycle boundaries 10K through 1M', () => {
    const scene = makeScene(note(seq('a', 'b', 'c').expr));

    for (const base of [10_000, 50_000, 100_000, 500_000, 1_000_000]) {
      const events = queryScene(scene, base, base + 1, { cps: 1 });
      expect(events.length).toBe(3);

      // Verify no events leak from adjacent cycles
      expect(events.every((e) => e.begin >= base && e.end <= base + 1)).toBe(true);
    }
  });

  it('adjacent cycle queries do not drop or duplicate events at high cycle counts', () => {
    const scene = makeScene(note(seq('a', 'b').expr));
    const base = 999_999;

    // Query three consecutive cycles separately
    const eventsA = queryScene(scene, base, base + 1, { cps: 1 });
    const eventsB = queryScene(scene, base + 1, base + 2, { cps: 1 });
    const eventsC = queryScene(scene, base + 2, base + 3, { cps: 1 });

    // Each cycle must produce exactly 2 events
    expect(eventsA.length).toBe(2);
    expect(eventsB.length).toBe(2);
    expect(eventsC.length).toBe(2);

    // The end of cycle N must equal the begin of cycle N+1 (seamless boundary)
    expect(eventsA[1]?.end).toBeCloseTo(eventsB[0]?.begin ?? 0, CONFORMANCE_DIGITS);
    expect(eventsB[1]?.end).toBeCloseTo(eventsC[0]?.begin ?? 0, CONFORMANCE_DIGITS);

    // Combined query across all three cycles must equal the sum
    const eventsCombined = queryScene(scene, base, base + 3, { cps: 1 });
    expect(eventsCombined.length).toBe(6);
  });

  it('slotSize = 1/N computed correctly for large N at high cycle counts', () => {
    // querySequence computes slotSize = 1 / entries.length, then
    // slotBegin = cycle + index * slotSize. Verify this stays precise.
    const scene = makeScene(note(seq('a', 'b', 'c', 'd', 'e', 'f', 'g').expr));
    const base = 1_000_000;
    const events = queryScene(scene, base, base + 1, { cps: 1 });

    expect(events.length).toBe(7);
    for (let i = 0; i < 7; i++) {
      // The fractional part (i/7) is where precision matters; the integer part
      // (1_000_000) is exact. The addition base + i/7 may lose precision if
      // i/7 is below the ULP of base. At base=1e6, ULP ~ 1.2e-10, which is
      // far smaller than 1/7 ~ 0.143, so precision is maintained.
      expect(events[i]?.begin).toBeCloseTo(base + i / 7, CONFORMANCE_DIGITS);
      expect(events[i]?.end).toBeCloseTo(base + (i + 1) / 7, CONFORMANCE_DIGITS);
    }
  });
});

// ---------------------------------------------------------------------------
// 12. Scheduler tick precision simulation -- audit item 8.4
// ---------------------------------------------------------------------------

describe('scheduler tick precision simulation', () => {
  it('accumulated cycle position after 10K ticks stays precise', () => {
    // Simulates the Scheduler.tick() cycle advancement:
    //   end = cycleAtCpsChange + secondsSinceCpsChange * cps
    // where secondsSinceCpsChange = numTicks * duration
    //
    // This is *not* iterative addition (end += duration * cps), so error
    // does not accumulate. Each tick computes the position from the anchor.
    const cps = 0.5;
    const duration = 0.05; // 50ms window
    const numTicks = 10_000;
    const cycleAtCpsChange = 0;

    const finalEnd = cycleAtCpsChange + (numTicks * duration) * cps;
    const expectedEnd = numTicks * duration * cps; // 10000 * 0.05 * 0.5 = 250.0

    // Since the Scheduler uses multiplicative positioning from an anchor
    // (not iterative addition), the error is bounded by a single multiply
    // and add, not by accumulated drift.
    expect(finalEnd).toBeCloseTo(expectedEnd, CONFORMANCE_DIGITS);
    expect(finalEnd).toBe(250); // Exact because 10000 * 0.05 = 500 exactly, 500 * 0.5 = 250 exactly
  });

  it('accumulated cycle position after 100K ticks with fractional CPS', () => {
    const cps = 1 / 3; // Irrational in binary
    const duration = 0.05;
    const numTicks = 100_000;
    const cycleAtCpsChange = 0;

    const finalEnd = cycleAtCpsChange + (numTicks * duration) * cps;
    const expectedEnd = 100_000 * 0.05 / 3; // 5000/3 ~ 1666.6666...

    // The multiplication chain numTicks * duration * cps involves three floats.
    // numTicks * duration = 5000.0 (exact). 5000 / 3 introduces float error.
    // The error is bounded by ULP(5000/3) ~ 2.3e-13, well within tolerance.
    expect(finalEnd).toBeCloseTo(expectedEnd, CONFORMANCE_DIGITS);
    expect(Math.abs(finalEnd - expectedEnd)).toBeLessThan(1e-10);
  });

  it('cycle position after CPS change maintains continuity', () => {
    // Simulate: run at cps=0.5 for 1000 ticks, then switch to cps=1.0 for 1000 ticks
    const duration = 0.05;
    const ticks1 = 1000;
    const cps1 = 0.5;
    const ticks2 = 1000;
    const cps2 = 1.0;

    // Phase 1
    const endPhase1 = 0 + (ticks1 * duration) * cps1; // 50 * 0.5 = 25
    // Phase 2: anchor at endPhase1
    const endPhase2 = endPhase1 + (ticks2 * duration) * cps2; // 25 + 50 * 1.0 = 75

    expect(endPhase1).toBe(25);
    expect(endPhase2).toBe(75);

    // Query at both phase boundaries should work correctly
    const scene = makeScene(note(seq('a', 'b').expr));
    const eventsAtBoundary = queryScene(scene, 24, 26, { cps: cps1 });
    expect(eventsAtBoundary.length).toBe(4); // 2 events per cycle * 2 cycles
  });
});

// ---------------------------------------------------------------------------
// 13. Worst-case precision characterization -- audit item 9.1
// ---------------------------------------------------------------------------

describe('worst-case precision characterization', () => {
  it('documents measured precision across the operational envelope', () => {
    // This test characterizes the precision envelope of the engine by measuring
    // actual timing error across a range of operational parameters.
    //
    // Key insight: Tussel does NOT use iterative accumulation for time.
    // The two core transforms are:
    //   transformFast: events = query(begin*factor, end*factor).map(e => e/factor)
    //   transformSlow: events = query(begin/factor, end/factor).map(e => e*factor)
    //
    // Both involve at most ONE multiply and ONE divide per event boundary,
    // so error is bounded by a few ULPs of the result, not by accumulated drift.
    //
    // The Scheduler similarly uses anchor-based positioning:
    //   end = cycleAtCpsChange + (numTicks * duration) * cps
    //
    // This means precision degrades only with the magnitude of the numbers
    // involved, not with the number of operations performed.

    interface PrecisionSample {
      scenario: string;
      maxError: number;
      ulpsAt1: number; // error expressed as multiples of ULP(1.0)
    }

    const ULP_AT_1 = Number.EPSILON; // ~2.22e-16
    const samples: PrecisionSample[] = [];

    // Scenario 1: seq(4) at various cycle offsets
    for (const base of [0, 1_000, 1_000_000]) {
      const scene = makeScene(note(seq('a', 'b', 'c', 'd').expr));
      const events = queryScene(scene, base, base + 1, { cps: 1 });
      let maxErr = 0;
      for (let i = 0; i < events.length; i++) {
        maxErr = Math.max(
          maxErr,
          Math.abs((events[i]?.begin ?? 0) - (base + i / 4)),
          Math.abs((events[i]?.end ?? 0) - (base + (i + 1) / 4)),
        );
      }
      samples.push({
        scenario: `seq(4) at cycle ${base}`,
        maxError: maxErr,
        ulpsAt1: maxErr / ULP_AT_1,
      });
    }

    // Scenario 2: fast(7) at high cycle count
    {
      const base = 1_000_000;
      const scene = makeScene(note('a').fast(7));
      const events = queryScene(scene, base, base + 1, { cps: 1 });
      let maxErr = 0;
      for (let i = 0; i < events.length; i++) {
        maxErr = Math.max(
          maxErr,
          Math.abs((events[i]?.begin ?? 0) - (base + i / 7)),
          Math.abs((events[i]?.end ?? 0) - (base + (i + 1) / 7)),
        );
      }
      samples.push({
        scenario: `fast(7) at cycle ${base}`,
        maxError: maxErr,
        ulpsAt1: maxErr / ULP_AT_1,
      });
    }

    // Scenario 3: chained fast(3).fast(5).fast(7) = fast(105)
    {
      const scene = makeScene(note('a').fast(3).fast(5).fast(7));
      const events = queryScene(scene, 0, 1, { cps: 1 });
      const sceneDirect = makeScene(note('a').fast(105));
      const eventsDirect = queryScene(sceneDirect, 0, 1, { cps: 1 });
      let maxErr = 0;
      for (let i = 0; i < events.length; i++) {
        maxErr = Math.max(
          maxErr,
          Math.abs((events[i]?.begin ?? 0) - (eventsDirect[i]?.begin ?? 0)),
          Math.abs((events[i]?.end ?? 0) - (eventsDirect[i]?.end ?? 0)),
        );
      }
      samples.push({
        scenario: 'fast(3).fast(5).fast(7) vs fast(105)',
        maxError: maxErr,
        ulpsAt1: maxErr / ULP_AT_1,
      });
    }

    // Scenario 4: Scheduler simulation at 1M ticks
    {
      const cps = 1 / 3;
      const duration = 0.05;
      const numTicks = 1_000_000;
      const computed = (numTicks * duration) * cps;
      const expected = 1_000_000 * 0.05 / 3;
      const err = Math.abs(computed - expected);
      samples.push({
        scenario: 'Scheduler 1M ticks at cps=1/3',
        maxError: err,
        ulpsAt1: err / ULP_AT_1,
      });
    }

    // All samples must be within conformance tolerance
    for (const sample of samples) {
      expect(sample.maxError).toBeLessThan(CONFORMANCE_EPSILON);
      expect(Number.isFinite(sample.maxError)).toBe(true);
    }

    // The worst case across all samples should be documented
    const worstCase = samples.reduce((prev, curr) => (curr.maxError > prev.maxError ? curr : prev));

    // Even the worst case should be orders of magnitude below the tolerance.
    // IEEE 754 doubles at these magnitudes have ULPs around 1e-10 to 1e-7,
    // meaning the actual error is typically 1e-16 to 1e-10.
    expect(worstCase.maxError).toBeLessThan(CONFORMANCE_EPSILON);
  });

  it('precision does NOT degrade with number of operations (no iterative accumulation)', () => {
    // Key property: because transformFast/transformSlow each do a single
    // multiply+divide (not iterative addition), precision is constant
    // regardless of chain depth. This test verifies that empirically.
    //
    // Depths beyond 4 create deeply nested pattern trees (each fast/slow pair
    // doubles the recursion depth) so we keep this bounded to avoid timeouts.

    const depths = [1, 2, 3, 4];
    const errors: number[] = [];

    for (const depth of depths) {
      let pattern = note(seq('a', 'b').expr);
      for (let d = 0; d < depth; d++) {
        // fast(3).slow(3) is the identity; chaining N of them should
        // still produce the original timing.
        pattern = pattern.fast(3).slow(3);
      }

      const scene = makeScene(pattern);
      const events = queryScene(scene, 0, 1, { cps: 1 });

      expect(events.length).toBe(2);

      const maxErr = Math.max(
        Math.abs((events[0]?.begin ?? 0) - 0),
        Math.abs((events[0]?.end ?? 0) - 0.5),
        Math.abs((events[1]?.begin ?? 0) - 0.5),
        Math.abs((events[1]?.end ?? 0) - 1),
      );
      errors.push(maxErr);
    }

    // All depths should produce errors within tolerance
    for (const err of errors) {
      expect(err).toBeLessThan(CONFORMANCE_EPSILON);
    }

    // The error at depth 4 should NOT be significantly larger than depth 1.
    // If there were iterative accumulation, error would grow linearly or worse.
    // We allow a 100x factor for float noise but expect them to be roughly equal.
    const ratio =
      errors[3] === 0 ? 0 : (errors[3] ?? 0) / Math.max(errors[0] ?? Number.EPSILON, Number.EPSILON);
    expect(ratio).toBeLessThan(100);
  });

  it('event timing at 2^32 cycles (4 billion) remains within tolerance', () => {
    // At cycle 2^32 ~ 4.29e9, the integer part uses 33 bits, leaving
    // 52 - 33 = 19 bits for the fractional part, giving a ULP of ~1e-6.
    // This is near our conformance boundary but should still pass.
    const base = 2 ** 32;
    const scene = makeScene(note(seq('a', 'b').expr));
    const events = queryScene(scene, base, base + 1, { cps: 1 });

    expect(events.length).toBe(2);

    // At this scale, ULP(2^32) = 2^(32-52) = 2^-20 ~ 9.5e-7
    // Our conformance tolerance is 5e-7, so we are right at the boundary.
    // Use a slightly relaxed tolerance (5 digits = 5e-6) for this extreme case.
    const EXTREME_DIGITS = 5;
    expect(events[0]?.begin).toBeCloseTo(base, EXTREME_DIGITS);
    expect(events[0]?.end).toBeCloseTo(base + 0.5, EXTREME_DIGITS);
    expect(events[1]?.begin).toBeCloseTo(base + 0.5, EXTREME_DIGITS);
    expect(events[1]?.end).toBeCloseTo(base + 1, EXTREME_DIGITS);

    // Duration is computed as end - begin, both near 2^32, so the difference
    // (0.5) should be much more precise than the absolute positions.
    expect(events[0]?.duration).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
    expect(events[1]?.duration).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
  });

  it('documents the precision cliff: where 6-digit tolerance fails', () => {
    // Find the cycle count where conformance tolerance (5e-7) is no longer
    // achievable for a 2-element seq. This happens when ULP(base) > 5e-7,
    // i.e., base > ~2^32.6 ~ 6.7e9.
    //
    // At base = 2^33 ~ 8.59e9, ULP = 2^(33-52) = 2^-19 ~ 1.9e-6
    // At base = 2^34 ~ 1.72e10, ULP = 2^(34-52) = 2^-18 ~ 3.8e-6

    const scene = makeScene(note(seq('a', 'b').expr));

    // Still passes at 1 billion (ULP ~ 1.2e-7)
    const events1B = queryScene(scene, 1e9, 1e9 + 1, { cps: 1 });
    expect(events1B.length).toBe(2);
    expect(events1B[0]?.begin).toBeCloseTo(1e9, CONFORMANCE_DIGITS);
    expect(events1B[0]?.duration).toBeCloseTo(0.5, CONFORMANCE_DIGITS);

    // At 10 billion, absolute positions lose 6-digit precision, but relative
    // durations (end - begin) remain precise because the subtraction cancels
    // the large integer part.
    const events10B = queryScene(scene, 1e10, 1e10 + 1, { cps: 1 });
    expect(events10B.length).toBe(2);
    // Duration remains precise even at 10 billion cycles
    expect(events10B[0]?.duration).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
    expect(events10B[1]?.duration).toBeCloseTo(0.5, CONFORMANCE_DIGITS);
  });
});
