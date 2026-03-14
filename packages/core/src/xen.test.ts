import { describe, expect, it } from 'vitest';
import { centsToRatio, createEdoScale, edoFrequency, parseXenValue, ratioToCents } from './xen.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_FREQ = 261.63; // C4

// ---------------------------------------------------------------------------
// edoFrequency
// ---------------------------------------------------------------------------

describe('edoFrequency', () => {
  it('step 0 returns the base frequency', () => {
    expect(edoFrequency(0, 12)).toBeCloseTo(DEFAULT_BASE_FREQ, 2);
    expect(edoFrequency(0, 19)).toBeCloseTo(DEFAULT_BASE_FREQ, 2);
    expect(edoFrequency(0, 24)).toBeCloseTo(DEFAULT_BASE_FREQ, 2);
  });

  it('one full octave (step = edo) doubles the base frequency', () => {
    expect(edoFrequency(12, 12)).toBeCloseTo(DEFAULT_BASE_FREQ * 2, 2);
    expect(edoFrequency(19, 19)).toBeCloseTo(DEFAULT_BASE_FREQ * 2, 2);
    expect(edoFrequency(24, 24)).toBeCloseTo(DEFAULT_BASE_FREQ * 2, 2);
    expect(edoFrequency(31, 31)).toBeCloseTo(DEFAULT_BASE_FREQ * 2, 2);
    expect(edoFrequency(53, 53)).toBeCloseTo(DEFAULT_BASE_FREQ * 2, 2);
  });

  it('12-EDO produces standard A4 = 440 Hz', () => {
    // A4 is 9 semitones above C4 in 12-TET
    const a4 = edoFrequency(9, 12, DEFAULT_BASE_FREQ);
    expect(a4).toBeCloseTo(440, 0);
  });

  it('12-EDO produces standard E4 frequency', () => {
    // E4 is 4 semitones above C4
    const e4 = edoFrequency(4, 12, DEFAULT_BASE_FREQ);
    expect(e4).toBeCloseTo(329.63, 0);
  });

  it('supports custom base frequency', () => {
    const base = 440;
    expect(edoFrequency(0, 12, base)).toBeCloseTo(440, 2);
    expect(edoFrequency(12, 12, base)).toBeCloseTo(880, 2);
  });

  it('supports negative steps', () => {
    // One octave down
    expect(edoFrequency(-12, 12)).toBeCloseTo(DEFAULT_BASE_FREQ / 2, 2);
  });

  it('19-EDO produces different frequencies than 12-EDO for the same step', () => {
    // Step 7 in 12-EDO vs step 7 in 19-EDO should differ
    const freq12 = edoFrequency(7, 12);
    const freq19 = edoFrequency(7, 19);
    expect(freq12).not.toBeCloseTo(freq19, 1);
  });

  it('24-EDO (quarter tones) step 2 equals 12-EDO step 1', () => {
    // 2 steps of 24-EDO = 1 step of 12-EDO (both are one semitone)
    const quarterTone2 = edoFrequency(2, 24);
    const semitone1 = edoFrequency(1, 12);
    expect(quarterTone2).toBeCloseTo(semitone1, 4);
  });

  it('throws on non-positive edo', () => {
    expect(() => edoFrequency(0, 0)).toThrow(RangeError);
    expect(() => edoFrequency(0, -5)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// centsToRatio / ratioToCents
// ---------------------------------------------------------------------------

describe('centsToRatio', () => {
  it('0 cents = ratio 1', () => {
    expect(centsToRatio(0)).toBeCloseTo(1, 10);
  });

  it('1200 cents = ratio 2 (one octave)', () => {
    expect(centsToRatio(1200)).toBeCloseTo(2, 10);
  });

  it('700 cents ~ perfect fifth (3/2)', () => {
    // The 12-TET perfect fifth is 700 cents, which is close to 3/2 = 1.5
    expect(centsToRatio(700)).toBeCloseTo(1.4983, 3);
  });

  it('100 cents = one semitone in 12-TET', () => {
    expect(centsToRatio(100)).toBeCloseTo(2 ** (1 / 12), 10);
  });
});

describe('ratioToCents', () => {
  it('ratio 1 = 0 cents', () => {
    expect(ratioToCents(1)).toBeCloseTo(0, 10);
  });

  it('ratio 2 = 1200 cents', () => {
    expect(ratioToCents(2)).toBeCloseTo(1200, 10);
  });

  it('ratio 3/2 ~ 701.96 cents', () => {
    expect(ratioToCents(3 / 2)).toBeCloseTo(701.955, 2);
  });

  it('throws on non-positive ratio', () => {
    expect(() => ratioToCents(0)).toThrow(RangeError);
    expect(() => ratioToCents(-1)).toThrow(RangeError);
  });
});

describe('cents roundtrip', () => {
  it('centsToRatio then ratioToCents returns original value', () => {
    for (const cents of [0, 100, 386.31, 700, 1200, 2400]) {
      expect(ratioToCents(centsToRatio(cents))).toBeCloseTo(cents, 6);
    }
  });

  it('ratioToCents then centsToRatio returns original value', () => {
    for (const ratio of [1, 1.25, 1.5, 2, 3, 4]) {
      expect(centsToRatio(ratioToCents(ratio))).toBeCloseTo(ratio, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// createEdoScale
// ---------------------------------------------------------------------------

describe('createEdoScale', () => {
  it('returns a function that maps steps to frequencies', () => {
    const scale = createEdoScale(12);
    expect(typeof scale).toBe('function');
    expect(scale(0)).toBeCloseTo(DEFAULT_BASE_FREQ, 2);
    expect(scale(12)).toBeCloseTo(DEFAULT_BASE_FREQ * 2, 2);
  });

  it('accepts custom base frequency', () => {
    const scale = createEdoScale(19, 440);
    expect(scale(0)).toBeCloseTo(440, 2);
    expect(scale(19)).toBeCloseTo(880, 2);
  });

  it('throws on non-positive edo', () => {
    expect(() => createEdoScale(0)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// parseXenValue
// ---------------------------------------------------------------------------

describe('parseXenValue', () => {
  it('parses EDO step notation "7\\12"', () => {
    const ratio = parseXenValue('7\\12');
    // 7 steps of 12-EDO = 2^(7/12)
    expect(ratio).toBeCloseTo(2 ** (7 / 12), 6);
  });

  it('parses EDO step notation "11\\19"', () => {
    const ratio = parseXenValue('11\\19');
    expect(ratio).toBeCloseTo(2 ** (11 / 19), 6);
  });

  it('parses just ratio "3/2"', () => {
    expect(parseXenValue('3/2')).toBeCloseTo(1.5, 6);
  });

  it('parses just ratio "5/4"', () => {
    expect(parseXenValue('5/4')).toBeCloseTo(1.25, 6);
  });

  it('parses just ratio "7/4"', () => {
    expect(parseXenValue('7/4')).toBeCloseTo(1.75, 6);
  });

  it('parses cents notation "700.0"', () => {
    const ratio = parseXenValue('700.0');
    expect(ratio).toBeCloseTo(centsToRatio(700), 6);
  });

  it('parses cents notation "386.31" (just major third)', () => {
    const ratio = parseXenValue('386.31');
    // ~5/4 ratio
    expect(ratio).toBeCloseTo(1.25, 2);
  });

  it('returns undefined for empty string', () => {
    expect(parseXenValue('')).toBeUndefined();
    expect(parseXenValue('  ')).toBeUndefined();
  });

  it('returns undefined for invalid notation', () => {
    expect(parseXenValue('abc')).toBeUndefined();
    expect(parseXenValue('3/0')).toBeUndefined(); // division by zero gives Infinity
  });

  it('handles bare integers as raw ratios', () => {
    expect(parseXenValue('2')).toBe(2);
    expect(parseXenValue('3')).toBe(3);
  });

  it('handles whitespace', () => {
    expect(parseXenValue(' 3/2 ')).toBeCloseTo(1.5, 6);
    expect(parseXenValue(' 7\\12 ')).toBeCloseTo(2 ** (7 / 12), 6);
  });
});

// ---------------------------------------------------------------------------
// Integration: EDO step size comparison
// ---------------------------------------------------------------------------

describe('EDO tuning comparison', () => {
  it('12-EDO semitone equals 100 cents', () => {
    const ratio = edoFrequency(1, 12) / edoFrequency(0, 12);
    expect(ratioToCents(ratio)).toBeCloseTo(100, 6);
  });

  it('19-EDO step equals ~63.16 cents', () => {
    const ratio = edoFrequency(1, 19) / edoFrequency(0, 19);
    expect(ratioToCents(ratio)).toBeCloseTo(1200 / 19, 2);
  });

  it('24-EDO step equals 50 cents (quarter tone)', () => {
    const ratio = edoFrequency(1, 24) / edoFrequency(0, 24);
    expect(ratioToCents(ratio)).toBeCloseTo(50, 6);
  });

  it('31-EDO step equals ~38.71 cents', () => {
    const ratio = edoFrequency(1, 31) / edoFrequency(0, 31);
    expect(ratioToCents(ratio)).toBeCloseTo(1200 / 31, 2);
  });

  it('53-EDO step equals ~22.64 cents', () => {
    const ratio = edoFrequency(1, 53) / edoFrequency(0, 53);
    expect(ratioToCents(ratio)).toBeCloseTo(1200 / 53, 2);
  });

  it('53-EDO has a near-perfect fifth at step 31', () => {
    // 53-EDO is famous for approximating just intonation well
    const ratio = edoFrequency(31, 53) / edoFrequency(0, 53);
    // Just perfect fifth = 3/2 = 701.955 cents
    const cents = ratioToCents(ratio);
    expect(cents).toBeCloseTo(701.887, 1); // 31/53 * 1200 ≈ 701.887
  });

  it('19-EDO fifth at step 11 is close to just fifth', () => {
    const ratio = edoFrequency(11, 19) / edoFrequency(0, 19);
    const cents = ratioToCents(ratio);
    // 11/19 * 1200 ≈ 694.74
    expect(cents).toBeCloseTo(694.74, 1);
  });
});

// ---------------------------------------------------------------------------
// Integration: DSL .edo() method produces events with edo property
// ---------------------------------------------------------------------------

describe('DSL .edo() integration', () => {
  it('edo method creates the expected expression node', async () => {
    // Import the DSL to test .edo() method exists and works
    const { note } = await import('@tussel/dsl');
    const pattern = note('0 4 7').edo(19);
    const json = pattern.toJSON();
    // The expression should be a method call named 'edo' with arg 19
    expect(json.kind).toBe('method');
    expect(json.name).toBe('edo');
    expect(json.args).toEqual([19]);
  });

  it('pattern with .edo(19) resolves differently from default 12-TET', async () => {
    const { queryScene } = await import('@tussel/core');
    const { defineScene, note } = await import('@tussel/dsl');

    // Query a pattern with .edo(19)
    const sceneEdo = defineScene({
      channels: {
        lead: { node: note(0).edo(19).toJSON() },
      },
    });

    const sceneDefault = defineScene({
      channels: {
        lead: { node: note(0).toJSON() },
      },
    });

    const eventsEdo = queryScene(sceneEdo, 0, 1, { cps: 1 });
    const eventsDefault = queryScene(sceneDefault, 0, 1, { cps: 1 });

    // Both should produce events
    expect(eventsEdo.length).toBeGreaterThan(0);
    expect(eventsDefault.length).toBeGreaterThan(0);

    // The EDO pattern should have an 'edo' payload property
    expect(eventsEdo[0]?.payload.edo).toBe(19);

    // The default pattern should NOT have an 'edo' payload property
    expect(eventsDefault[0]?.payload.edo).toBeUndefined();
  });
});
