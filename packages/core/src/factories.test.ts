import { queryScene } from '@tussel/core';
import {
  choose,
  defineScene,
  note,
  polymeter,
  polyrhythm,
  s,
  seq,
  sequence,
  silence,
  stack,
  wchoose,
} from '@tussel/dsl';
import type { ExpressionValue } from '@tussel/ir';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScene(node: unknown, channel = 'main') {
  return defineScene({
    channels: { [channel]: { node: node as ExpressionValue } },
  });
}

function query(node: unknown, begin = 0, end = 1) {
  return queryScene(makeScene(node), begin, end, { cps: 1 });
}

// ---------------------------------------------------------------------------
// Factory functions (audit item 1.9)
// ---------------------------------------------------------------------------

describe('factory: choose', () => {
  it('selects one of the provided patterns per cycle', () => {
    const events = query(choose(note(0), note(1), note(2)));
    expect(events.length).toBeGreaterThanOrEqual(1);
    const n = events[0]?.payload.note;
    expect([0, 1, 2]).toContain(n);
  });

  it('is deterministic for same cycle', () => {
    const a = query(choose(note(0), note(1), note(2)));
    const b = query(choose(note(0), note(1), note(2)));
    expect(a.map((e) => e.payload.note)).toEqual(b.map((e) => e.payload.note));
  });

  it('may select different values across cycles', () => {
    const events0 = query(choose(note(0), note(1), note(2)), 0, 1);
    const events5 = query(choose(note(0), note(1), note(2)), 5, 6);
    // At minimum, both should produce events
    expect(events0.length).toBeGreaterThanOrEqual(1);
    expect(events5.length).toBeGreaterThanOrEqual(1);
  });
});

describe('factory: wchoose', () => {
  it('selects one of the provided patterns per cycle', () => {
    const events = query(wchoose(note(0), note(1)));
    expect(events.length).toBeGreaterThanOrEqual(1);
    const n = events[0]?.payload.note;
    expect([0, 1]).toContain(n);
  });

  it('is deterministic for same cycle', () => {
    const a = query(wchoose(note(10), note(20)));
    const b = query(wchoose(note(10), note(20)));
    expect(a.map((e) => e.payload.note)).toEqual(b.map((e) => e.payload.note));
  });
});

describe('factory: sequence', () => {
  it('subdivides the cycle like seq', () => {
    const events = query(sequence(note(0), note(1), note(2)));
    expect(events).toHaveLength(3);
    expect(events[0]?.payload.note).toBe(0);
    expect(events[1]?.payload.note).toBe(1);
    expect(events[2]?.payload.note).toBe(2);
  });

  it('events fill equal subdivisions', () => {
    const events = query(sequence(note(0), note(1)));
    expect(events[0]?.begin).toBeCloseTo(0, 9);
    expect(events[0]?.end).toBeCloseTo(0.5, 9);
    expect(events[1]?.begin).toBeCloseTo(0.5, 9);
    expect(events[1]?.end).toBeCloseTo(1, 9);
  });

  it('behaves identically to seq', () => {
    const seqEvents = query(seq(note(0), note(1), note(2)));
    const sequenceEvents = query(sequence(note(0), note(1), note(2)));
    expect(seqEvents.map((e) => e.payload.note)).toEqual(sequenceEvents.map((e) => e.payload.note));
  });
});

describe('factory: polyrhythm', () => {
  it('stacks all patterns (each plays full cycle)', () => {
    const events = query(polyrhythm(note(0), note(1)));
    expect(events).toHaveLength(2);
    const notes = events.map((e) => e.payload.note).sort();
    expect(notes).toEqual([0, 1]);
  });

  it('preserves independent timing', () => {
    const events = query(polyrhythm(s('bd sd'), note(0)));
    // bd sd = 2 events, note(0) = 1 event => 3 total
    expect(events).toHaveLength(3);
  });

  it('single pattern is identity', () => {
    const events = query(polyrhythm(note(42)));
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.note).toBe(42);
  });
});

describe('factory: polymeter', () => {
  it('gives each pattern its own step count', () => {
    const events = query(polymeter(note('0 1 2'), note('10 11')));
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it('single pattern behaves like normal', () => {
    const events = query(polymeter(note('0 1')));
    expect(events).toHaveLength(2);
    expect(events[0]?.payload.note).toBe(0);
    expect(events[1]?.payload.note).toBe(1);
  });

  it('wraps shorter patterns across cycles', () => {
    // polymeter([a b c], [x y]): pattern 2 has 2 steps, wraps in cycle 2
    const cycle0 = query(polymeter(note('0 1 2'), note('10 11')), 0, 1);
    const cycle1 = query(polymeter(note('0 1 2'), note('10 11')), 1, 2);
    expect(cycle0.length).toBeGreaterThanOrEqual(2);
    expect(cycle1.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Negative input handling (audit item 4.12)
// ---------------------------------------------------------------------------

describe('negative/invalid inputs', () => {
  it('queryScene throws on NaN begin', () => {
    const scene = makeScene(s('bd'));
    expect(() => queryScene(scene, Number.NaN, 1, { cps: 1 })).toThrow();
  });

  it('queryScene throws on NaN end', () => {
    const scene = makeScene(s('bd'));
    expect(() => queryScene(scene, 0, Number.NaN, { cps: 1 })).toThrow();
  });

  it('queryScene throws on Infinity', () => {
    const scene = makeScene(s('bd'));
    expect(() => queryScene(scene, 0, Number.POSITIVE_INFINITY, { cps: 1 })).toThrow();
  });

  it('queryScene throws when end < begin', () => {
    const scene = makeScene(s('bd'));
    expect(() => queryScene(scene, 1, 0, { cps: 1 })).toThrow();
  });

  it('zero-width query returns no events', () => {
    const events = query(s('bd'), 0, 0);
    expect(events).toHaveLength(0);
  });

  it('defineScene rejects empty channels', () => {
    expect(() => defineScene({ channels: {} })).toThrow();
  });

  it('empty mini-notation pattern produces no events', () => {
    const events = query(s(''));
    expect(events).toHaveLength(0);
  });

  it('fast(0) returns empty', () => {
    const events = query(note('c4').fast(0));
    expect(events).toHaveLength(0);
  });

  it('very large fast value still works without hanging', () => {
    const events = query(note('c4').fast(10000));
    expect(events.length).toBeGreaterThan(100);
  });

  it('deeply nested patterns do not stack overflow', () => {
    let pattern = note('c4') as ReturnType<typeof note>;
    for (let i = 0; i < 50; i++) {
      pattern = pattern.fast(1);
    }
    const events = query(pattern);
    expect(events).toHaveLength(1);
  });

  it('stack with silence produces only non-silent events', () => {
    const events = query(stack(s('bd'), silence()));
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.s).toBe('bd');
  });

  it('silence factory produces zero events', () => {
    const events = query(silence());
    expect(events).toHaveLength(0);
  });
});
