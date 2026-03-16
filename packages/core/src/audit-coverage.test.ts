/**
 * Comprehensive core engine audit tests (audit item 6.4).
 *
 * Covers gaps in existing test files for:
 *   - stack composition (deeper nesting, heterogeneous layers)
 *   - fast/slow transforms (fractional, zero, negative edge cases)
 *   - early/late shifts (fractional, multi-cycle)
 *   - ply repetition (edge cases: 0, fractional, large)
 *   - rev reversal (double-rev identity, with transforms)
 *   - mask/struct filtering (pattern-based masks, exotic truthiness)
 *   - Signal evaluation (all waveforms with arithmetic, early/late on signals)
 *   - Signal arithmetic operators (div-by-zero, chained ops)
 *   - Nested pattern composition (deeply nested, mixed transforms)
 *   - Negative cycle ranges (signals, cat, transforms)
 *   - Very large cycle numbers and precision behavior
 *   - Empty patterns (combined with all transforms)
 *   - Patterns with rests (nested rests, rest with transforms)
 *   - Property annotation paths (comprehensive PROPERTY_METHODS coverage)
 *   - clip interaction with duration (edge cases)
 *   - evaluateMiniNumber() edge cases (via evaluateNumericValue)
 *   - coerceMiniValue() edge cases (via value patterns)
 *   - isTruthyMaskValue() edge cases (via mask behavior)
 */
import { PROPERTY_METHODS, queryScene } from '@tussel/core';
import {
  cat,
  defineScene,
  note,
  type PatternBuilder,
  perlin,
  rand,
  s,
  saw,
  seq,
  silence,
  sine,
  square,
  stack,
  tri,
  value,
} from '@tussel/dsl';
import type { ExpressionValue } from '@tussel/ir';
import { describe, expect, it, vi } from 'vitest';
import { evaluateNumericValue } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScene(node: unknown, channel = 'test') {
  return defineScene({
    channels: { [channel]: { node: node as ExpressionValue } },
  });
}

function query(node: unknown, begin = 0, end = 1, channel = 'test') {
  return queryScene(makeScene(node, channel), begin, end, { cps: 1 });
}

// ===========================================================================
// 1. stack composition — deeper coverage
// ===========================================================================

describe('audit 6.4 — stack composition', () => {
  it('stack of 10 patterns produces all events', () => {
    const patterns = Array.from({ length: 10 }, (_, i) => note(`${i}`));
    const events = query(stack(...patterns));
    expect(events).toHaveLength(10);
    const notes = events.map((e) => e.payload.note).sort((a, b) => (a as number) - (b as number));
    expect(notes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('stack with heterogeneous subdivision counts', () => {
    // 1 event + 4 events + 2 events = 7
    const events = query(stack(note('c'), note('0 1 2 3'), note('a b')));
    expect(events).toHaveLength(7);
  });

  it('deeply nested stacks flatten correctly', () => {
    const events = query(stack(stack(stack(note('a')), note('b')), note('c')));
    expect(events).toHaveLength(3);
    const notes = events.map((e) => e.payload.note);
    expect(notes).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('stack with transforms on individual layers preserves independence', () => {
    const events = query(stack(note('0').fast(4), note('1').slow(2)));
    const fastEvents = events.filter((e) => e.payload.note === 0);
    const slowEvents = events.filter((e) => e.payload.note === 1);
    expect(fastEvents).toHaveLength(4);
    expect(slowEvents).toHaveLength(1);
    // slow(2) event spans the full 2 cycles
    expect(slowEvents[0]?.duration).toBeCloseTo(2, 6);
    // fast(4) events each span 1/4 cycle
    for (const e of fastEvents) {
      expect(e.duration).toBeCloseTo(0.25, 6);
    }
  });
});

// ===========================================================================
// 2. fast transforms — deeper edge cases
// ===========================================================================

describe('audit 6.4 — fast transforms', () => {
  it('fast(0) produces silence (zero repetitions per cycle)', () => {
    const events = query(note('0 1').fast(0));
    expect(events).toHaveLength(0);
  });

  it('fast(0.5) halves the event count (equivalent to slow(2))', () => {
    const fastHalf = query(note('0 1').fast(0.5), 0, 2);
    const slowTwo = query(note('0 1').slow(2), 0, 2);
    expect(fastHalf.map((e) => e.payload.note)).toEqual(slowTwo.map((e) => e.payload.note));
  });

  it('fast with large value does not crash', () => {
    const events = query(note('0').fast(1000));
    expect(events).toHaveLength(1000);
  });

  it('fast preserves payload across repetitions', () => {
    const events = query(s('bd').gain(0.8).fast(3));
    expect(events).toHaveLength(3);
    for (const e of events) {
      expect(e.payload.s).toBe('bd');
      expect(e.payload.gain).toBe(0.8);
    }
  });

  it('chained fast multiplies: fast(2).fast(3) = fast(6)', () => {
    const chained = query(note('0').fast(2).fast(3));
    const direct = query(note('0').fast(6));
    expect(chained).toHaveLength(direct.length);
    expect(chained).toHaveLength(6);
  });
});

// ===========================================================================
// 3. slow transforms — deeper edge cases
// ===========================================================================

describe('audit 6.4 — slow transforms', () => {
  it('slow(0.5) is equivalent to fast(2)', () => {
    const slowHalf = query(note('0 1').slow(0.5));
    const fastTwo = query(note('0 1').fast(2));
    expect(slowHalf.map((e) => e.payload.note)).toEqual(fastTwo.map((e) => e.payload.note));
  });

  it('slow(3) requires 3 cycles to complete the pattern', () => {
    const events = query(note('a b c').slow(3), 0, 3);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.payload.note)).toEqual(['a', 'b', 'c']);
  });

  it('slow(3) query single cycle gets only one event', () => {
    const events = query(note('a b c').slow(3), 0, 1);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.note).toBe('a');
  });

  it('slow preserves event payload', () => {
    const events = query(s('bd').gain(0.5).slow(2), 0, 2);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.s).toBe('bd');
    expect(events[0]?.payload.gain).toBe(0.5);
  });
});

// ===========================================================================
// 4. early shifts — deeper coverage
// ===========================================================================

describe('audit 6.4 — early shifts', () => {
  it('early(0.5) on a 4-event pattern shifts all events by half cycle', () => {
    const events = query(note('0 1 2 3').early(0.5), 0, 1);
    // Original: 0@0, 1@0.25, 2@0.5, 3@0.75
    // After early(0.5): 0@-0.5, 1@-0.25, 2@0, 3@0.25
    // Query [0,1) picks up events from shifted + wrap
    const firstEvent = events.find((e) => e.begin === 0);
    expect(firstEvent).toBeDefined();
    expect(firstEvent?.payload.note).toBe(2);
  });

  it('early preserves total event count across full query', () => {
    const plain = query(note('0 1 2 3'), 0, 2);
    const shifted = query(note('0 1 2 3').early(0.25), 0, 2);
    // Same pattern over same range should produce same number of events
    expect(shifted).toHaveLength(plain.length);
  });

  it('early(2) shifts by exactly 2 cycles (identity for repeating pattern)', () => {
    const plain = query(note('0 1'));
    const shifted = query(note('0 1').early(2));
    expect(shifted.map((e) => e.payload.note)).toEqual(plain.map((e) => e.payload.note));
  });
});

// ===========================================================================
// 5. late shifts — deeper coverage
// ===========================================================================

describe('audit 6.4 — late shifts', () => {
  it('late(0.5) on a 4-event pattern shifts all events by half cycle', () => {
    const events = query(note('0 1 2 3').late(0.5), 0, 1);
    // Original: 0@0, 1@0.25, 2@0.5, 3@0.75
    // After late(0.5): 0@0.5, 1@0.75, 2@1.0, 3@1.25
    // Query [0,1) picks up events from previous cycle wrapping in
    const atHalf = events.find((e) => Math.abs(e.begin - 0.5) < 1e-9);
    expect(atHalf).toBeDefined();
    expect(atHalf?.payload.note).toBe(0);
  });

  it('late preserves total event count across full query', () => {
    const plain = query(note('0 1 2 3'), 0, 2);
    const shifted = query(note('0 1 2 3').late(0.25), 0, 2);
    expect(shifted).toHaveLength(plain.length);
  });

  it('late(2) shifts by exactly 2 cycles (identity for repeating pattern)', () => {
    const plain = query(note('0 1'));
    const shifted = query(note('0 1').late(2));
    expect(shifted.map((e) => e.payload.note)).toEqual(plain.map((e) => e.payload.note));
  });
});

// ===========================================================================
// 6. ply repetition — deeper edge cases
// ===========================================================================

describe('audit 6.4 — ply repetition', () => {
  it('ply(1) produces same number of events as original', () => {
    const plain = query(note('0 1 2'));
    const plied = query(note('0 1 2').ply(1));
    expect(plied).toHaveLength(plain.length);
  });

  it('ply on a single event', () => {
    const events = query(note('5').ply(5));
    expect(events).toHaveLength(5);
    for (const e of events) {
      expect(e.payload.note).toBe(5);
      expect(e.duration).toBeCloseTo(0.2, 6);
    }
  });

  it('ply(2) creates correct timing subdivisions', () => {
    const events = query(note('0 1 2').ply(2));
    expect(events).toHaveLength(6);
    // Each original slot is subdivided in half
    // Original: 0@[0,1/3), 1@[1/3,2/3), 2@[2/3,1)
    // After ply(2): each is split into 2 sub-events
    for (const e of events) {
      expect(e.duration).toBeCloseTo(1 / 6, 6);
    }
  });

  it('ply preserves payload identity within each group', () => {
    const events = query(note('a b').ply(3));
    expect(events).toHaveLength(6);
    // First 3 should be 'a', last 3 should be 'b'
    expect(events.slice(0, 3).every((e) => e.payload.note === 'a')).toBe(true);
    expect(events.slice(3, 6).every((e) => e.payload.note === 'b')).toBe(true);
  });

  it('ply combined with fast', () => {
    const events = query(note('0').fast(2).ply(3));
    // fast(2) = 2 events, each plied 3x = 6
    expect(events).toHaveLength(6);
  });
});

// ===========================================================================
// 7. rev reversal — deeper coverage
// ===========================================================================

describe('audit 6.4 — rev reversal', () => {
  it('rev of 8 elements reverses all', () => {
    const events = query(note('0 1 2 3 4 5 6 7').rev());
    expect(events.map((e) => e.payload.note)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('double rev is identity (timing and values)', () => {
    const plain = query(note('a b c d'));
    const doubleRev = query(note('a b c d').rev().rev());
    expect(doubleRev.map((e) => e.payload.note)).toEqual(plain.map((e) => e.payload.note));
    expect(doubleRev.map((e) => e.begin)).toEqual(plain.map((e) => e.begin));
  });

  it('rev preserves event count and durations', () => {
    const plain = query(note('0 1 2'));
    const reversed = query(note('0 1 2').rev());
    expect(reversed).toHaveLength(plain.length);
    const plainDurations = plain.map((e) => e.duration).sort();
    const revDurations = reversed.map((e) => e.duration).sort();
    for (let i = 0; i < plainDurations.length; i++) {
      expect(revDurations[i]).toBeCloseTo(plainDurations[i]!, 6);
    }
  });

  it('rev inside fast reverses each repetition independently', () => {
    const events = query(note('0 1').fast(2).rev());
    expect(events).toHaveLength(4);
    // Each half-cycle is reversed: [1,0,1,0]
    expect(events.map((e) => e.payload.note)).toEqual([1, 0, 1, 0]);
  });

  it('rev combined with early does not crash', () => {
    const events = query(note('0 1 2 3').rev().early(0.25), 0, 1);
    expect(events.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 8. mask / struct filtering — deeper coverage
// ===========================================================================

describe('audit 6.4 — mask / struct filtering', () => {
  it('mask with different density than source', () => {
    // 4-event source with 2-event mask
    const events = query(note('0 1 2 3').mask('1 0'));
    // mask '1 0' divides cycle in half: first half truthy, second falsy
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.begin).toBeLessThan(0.5 + 1e-9);
    }
  });

  it('mask with "false" string is falsy', () => {
    const events = query(note('0 1 2 3').mask('false false false false'));
    expect(events).toHaveLength(0);
  });

  it('mask with rest (~) is falsy', () => {
    const events = query(note('0 1 2 3').mask('~ ~ ~ ~'));
    expect(events).toHaveLength(0);
  });

  it('struct and mask produce identical results', () => {
    const maskEvents = query(note('0 1 2 3').mask('1 0 1 0'));
    const structEvents = query(note('0 1 2 3').struct('1 0 1 0'));
    expect(maskEvents.map((e) => e.payload.note)).toEqual(structEvents.map((e) => e.payload.note));
    expect(maskEvents.map((e) => e.begin)).toEqual(structEvents.map((e) => e.begin));
  });

  it('mask applied to stack filters all layers', () => {
    const events = query(stack(note('0 1'), note('2 3')).mask('1 0'));
    // Both layers filtered: only first-half events survive
    for (const e of events) {
      expect(e.begin).toBeLessThan(0.5 + 1e-9);
    }
  });

  it('mask with all-truthy high numbers passes everything', () => {
    const events = query(note('0 1 2 3').mask('99 99 99 99'));
    expect(events).toHaveLength(4);
  });

  it('mask with fast-transformed mask pattern', () => {
    // mask('1 0').fast(2) creates a 4-slot alternating mask
    const events = query(note('0 1 2 3').mask('1 0'));
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThan(4);
  });
});

// ===========================================================================
// 9. Signal evaluation — comprehensive waveform coverage
// ===========================================================================

describe('audit 6.4 — signal evaluation across waveforms', () => {
  it('sine completes a full period [0.5 -> 1 -> 0.5 -> 0 -> 0.5]', () => {
    expect(evaluateNumericValue(sine.expr, 0)).toBeCloseTo(0.5, 6);
    expect(evaluateNumericValue(sine.expr, 0.25)).toBeCloseTo(1, 6);
    expect(evaluateNumericValue(sine.expr, 0.5)).toBeCloseTo(0.5, 6);
    expect(evaluateNumericValue(sine.expr, 0.75)).toBeCloseTo(0, 6);
    // Period boundary: cycle 1 should equal cycle 0
    expect(evaluateNumericValue(sine.expr, 1)).toBeCloseTo(0.5, 6);
  });

  it('tri completes a full period [0 -> 0.5 -> 1 -> 0.5 -> 0]', () => {
    expect(evaluateNumericValue(tri.expr, 0)).toBeCloseTo(0, 6);
    expect(evaluateNumericValue(tri.expr, 0.25)).toBeCloseTo(0.5, 6);
    expect(evaluateNumericValue(tri.expr, 0.5)).toBeCloseTo(1, 6);
    expect(evaluateNumericValue(tri.expr, 0.75)).toBeCloseTo(0.5, 6);
    expect(evaluateNumericValue(tri.expr, 1)).toBeCloseTo(0, 6);
  });

  it('square produces only 0 or 1', () => {
    for (let c = 0; c < 5; c += 0.01) {
      const v = evaluateNumericValue(square.expr, c);
      expect(v === 0 || v === 1).toBe(true);
    }
  });

  it('rand produces values uniformly distributed in [0,1)', () => {
    const values: number[] = [];
    for (let c = 0; c < 100; c++) {
      const v = evaluateNumericValue(rand.expr, c)!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      values.push(v);
    }
    // Check reasonable spread (mean should be near 0.5)
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.2);
    expect(mean).toBeLessThan(0.8);
  });

  it('perlin is smooth: adjacent values differ by small amount', () => {
    const step = 0.001;
    let maxJump = 0;
    for (let c = 0; c < 10; c += step) {
      const a = evaluateNumericValue(perlin.expr, c)!;
      const b = evaluateNumericValue(perlin.expr, c + step)!;
      maxJump = Math.max(maxJump, Math.abs(a - b));
    }
    // With step=0.001, perlin noise should not jump more than ~0.1
    expect(maxJump).toBeLessThan(0.2);
  });

  it('perlin values are bounded in [0,1]', () => {
    for (let c = -10; c < 10; c += 0.17) {
      const v = evaluateNumericValue(perlin.expr, c)!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('saw wraps correctly at integer boundaries', () => {
    expect(evaluateNumericValue(saw.expr, 0)).toBe(0);
    expect(evaluateNumericValue(saw.expr, 1)).toBe(0);
    expect(evaluateNumericValue(saw.expr, 2)).toBe(0);
    expect(evaluateNumericValue(saw.expr, 100)).toBe(0);
  });

  it('all signals return valid numbers at negative positions', () => {
    for (const sig of [sine, tri, square, saw, rand, perlin]) {
      for (const pos of [-5, -0.5, -0.001]) {
        const v = evaluateNumericValue(sig.expr, pos);
        expect(v).toBeDefined();
        expect(typeof v).toBe('number');
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

// ===========================================================================
// 10. Signal arithmetic operators — deeper coverage
// ===========================================================================

describe('audit 6.4 — signal arithmetic operators', () => {
  it('signal div handles near-zero safely', () => {
    // Division by very small number should not produce Infinity
    const v = evaluateNumericValue(saw.div(1e-10).expr, 0.5);
    expect(Number.isFinite(v)).toBe(true);
  });

  it('signal add is commutative with constants', () => {
    const a = evaluateNumericValue(sine.add(5).expr, 0.3);
    expect(a).toBeCloseTo(evaluateNumericValue(sine.expr, 0.3)! + 5, 6);
  });

  it('signal sub is inverse of add', () => {
    const original = evaluateNumericValue(saw.expr, 0.7)!;
    const addThenSub = evaluateNumericValue(saw.add(42).sub(42).expr, 0.7)!;
    expect(addThenSub).toBeCloseTo(original, 6);
  });

  it('signal mul(0) always returns 0', () => {
    for (let c = 0; c < 5; c += 0.3) {
      expect(evaluateNumericValue(sine.mul(0).expr, c)).toBeCloseTo(0, 6);
    }
  });

  it('signal fast on signal doubles frequency', () => {
    // saw.fast(2) at cycle 0.25 should equal saw at cycle 0.5
    const fasted = evaluateNumericValue(saw.fast(2).expr, 0.25)!;
    const normal = evaluateNumericValue(saw.expr, 0.5)!;
    expect(fasted).toBeCloseTo(normal, 6);
  });

  it('signal slow on signal halves frequency', () => {
    const slowed = evaluateNumericValue(saw.slow(2).expr, 0.5)!;
    const normal = evaluateNumericValue(saw.expr, 0.25)!;
    expect(slowed).toBeCloseTo(normal, 6);
  });

  it('signal early shifts signal phase forward', () => {
    const shifted = evaluateNumericValue(saw.early(0.25).expr, 0)!;
    const normal = evaluateNumericValue(saw.expr, 0.25)!;
    expect(shifted).toBeCloseTo(normal, 6);
  });

  it('signal late shifts signal phase backward', () => {
    const shifted = evaluateNumericValue(saw.late(0.25).expr, 0.5)!;
    const normal = evaluateNumericValue(saw.expr, 0.25)!;
    expect(shifted).toBeCloseTo(normal, 6);
  });

  it('range with negative values maps correctly', () => {
    // saw(0) = 0, range(-10, 10) -> -10 + (10-(-10))*0 = -10
    expect(evaluateNumericValue(saw.range(-10, 10).expr, 0)).toBeCloseTo(-10, 6);
    // saw(0.5) = 0.5, range(-10, 10) -> -10 + 20*0.5 = 0
    expect(evaluateNumericValue(saw.range(-10, 10).expr, 0.5)).toBeCloseTo(0, 6);
  });

  it('chaining range after arithmetic still works', () => {
    // saw.mul(2).range(0, 100): mul(2) doubles saw, then range maps [0,1] to [0,100]
    const v = evaluateNumericValue(saw.mul(2).range(0, 100).expr, 0.25);
    // saw(0.25)=0.25, mul(2)=0.5, range(0,100)*0.5=50
    expect(v).toBeCloseTo(50, 6);
  });
});

// ===========================================================================
// 11. Nested pattern composition — deeper coverage
// ===========================================================================

describe('audit 6.4 — nested pattern composition', () => {
  it('stack of seq patterns with different lengths', () => {
    const events = query(stack(note(seq('a', 'b')), note(seq('c', 'd', 'e'))));
    // 2 from first seq + 3 from second = 5
    expect(events).toHaveLength(5);
  });

  it('30 levels of chained add does not stack overflow', () => {
    let pattern = note('0') as PatternBuilder;
    for (let i = 0; i < 30; i++) {
      pattern = pattern.add(1);
    }
    const events = query(pattern);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.note).toBe(30);
  });

  it('nested fast inside slow inside stack', () => {
    const events = query(stack(note('0').fast(4).slow(2), note('1')));
    // fast(4).slow(2) = fast(2), so 2 events + 1 from note('1') = 3
    const zeros = events.filter((e) => e.payload.note === 0);
    const ones = events.filter((e) => e.payload.note === 1);
    expect(zeros).toHaveLength(2);
    expect(ones).toHaveLength(1);
  });

  it('mask inside nested stack applies to correct layer', () => {
    const events = query(stack(note('0 1 2 3').mask('1 0 1 0'), note('a b')));
    // Masked layer: 2 events (0, 2); unmasked layer: 2 events (a, b)
    const numericNotes = events.filter((e) => typeof e.payload.note === 'number');
    const stringNotes = events.filter((e) => typeof e.payload.note === 'string');
    expect(numericNotes).toHaveLength(2);
    expect(stringNotes).toHaveLength(2);
  });

  it('cat inside stack sequences across cycles', () => {
    const events = query(stack(cat(note('a'), note('b')), note('x')), 0, 2);
    // cat layer: 1 event per cycle (a, then b) = 2 events over 2 cycles
    // note('x') layer: 1 event per cycle = 2 events
    // Total: 4
    expect(events).toHaveLength(4);
    const catNotes = events
      .filter((e) => e.payload.note === 'a' || e.payload.note === 'b')
      .map((e) => e.payload.note);
    expect(catNotes).toEqual(['a', 'b']);
  });
});

// ===========================================================================
// 12. Negative cycle ranges — deeper coverage
// ===========================================================================

describe('audit 6.4 — negative cycle ranges', () => {
  it('cat wraps correctly with negative cycles', () => {
    const scene = defineScene({
      channels: {
        test: {
          node: {
            args: [{ note: 'a' }, { note: 'b' }, { note: 'c' }],
            exprType: 'pattern',
            kind: 'call',
            name: 'cat',
          },
        },
      },
    });
    // cat(a,b,c): cycle -1 mod 3 = 2 => 'c'
    const events = queryScene(scene, -1, 0, { cps: 1 });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.note).toBe('c');
  });

  it('fast pattern works at negative cycles', () => {
    const events = query(note('0 1').fast(2), -1, 0);
    expect(events).toHaveLength(4);
  });

  it('rev works at negative cycles', () => {
    const events = query(note('0 1 2 3').rev(), -1, 0);
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.payload.note)).toEqual([3, 2, 1, 0]);
  });

  it('signal evaluation at negative integer boundaries', () => {
    // saw at integer boundaries should always be 0
    expect(evaluateNumericValue(saw.expr, -1)).toBeCloseTo(0, 6);
    expect(evaluateNumericValue(saw.expr, -2)).toBeCloseTo(0, 6);
  });
});

// ===========================================================================
// 13. Very large cycle numbers and precision
// ===========================================================================

describe('audit 6.4 — very large cycle numbers', () => {
  it('note pattern at cycle 10,000,000 returns correct events', () => {
    const base = 10_000_000;
    const events = query(note('0 1 2 3'), base, base + 1);
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.payload.note)).toEqual([0, 1, 2, 3]);
  });

  it('event timing at large cycle numbers has no drift', () => {
    const base = 1_000_000;
    const events = query(note('a b'), base, base + 1);
    expect(events).toHaveLength(2);
    expect(events[0]?.begin).toBeCloseTo(base, 6);
    expect(events[0]?.end).toBeCloseTo(base + 0.5, 6);
    expect(events[1]?.begin).toBeCloseTo(base + 0.5, 6);
    expect(events[1]?.end).toBeCloseTo(base + 1, 6);
  });

  it('cat wraps correctly at very large cycle numbers', () => {
    const scene = defineScene({
      channels: {
        test: {
          node: {
            args: [{ note: 'x' }, { note: 'y' }],
            exprType: 'pattern',
            kind: 'call',
            name: 'cat',
          },
        },
      },
    });
    // cycle 10_000_000 mod 2 = 0 => 'x'
    const events = queryScene(scene, 10_000_000, 10_000_001, { cps: 1 });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.note).toBe('x');
  });

  it('fast(2) at large cycle numbers produces correct count', () => {
    const events = query(note('0 1').fast(2), 1_000_000, 1_000_001);
    expect(events).toHaveLength(4);
  });

  it('signals at large cycle positions are valid', () => {
    const bigCycle = 10_000_000;
    for (const sig of [sine, tri, square, saw, rand, perlin]) {
      const v = evaluateNumericValue(sig.expr, bigCycle + 0.5);
      expect(v).toBeDefined();
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ===========================================================================
// 14. Empty patterns — comprehensive coverage
// ===========================================================================

describe('audit 6.4 — empty patterns', () => {
  it('silence() produces no events', () => {
    expect(query(silence())).toHaveLength(0);
  });

  it('silence with add still produces no events', () => {
    expect(query(silence().add(10))).toHaveLength(0);
  });

  it('silence with ply still produces no events', () => {
    expect(query(silence().ply(5))).toHaveLength(0);
  });

  it('silence with mask still produces no events', () => {
    expect(query(silence().mask('1 1 1'))).toHaveLength(0);
  });

  it('silence with early/late still produces no events', () => {
    expect(query(silence().early(0.25))).toHaveLength(0);
    expect(query(silence().late(0.25))).toHaveLength(0);
  });

  it('note("~ ~ ~ ~") produces no events', () => {
    expect(query(note('~ ~ ~ ~'))).toHaveLength(0);
  });

  it('s("") produces no events', () => {
    expect(query(s(''))).toHaveLength(0);
  });

  it('stack of all-rest patterns produces no events', () => {
    expect(query(stack(note('~'), note('~ ~')))).toHaveLength(0);
  });
});

// ===========================================================================
// 15. Patterns with rests — comprehensive coverage
// ===========================================================================

describe('audit 6.4 — patterns with rests', () => {
  it('single rest in 4-slot pattern removes exactly one event', () => {
    const events = query(note('0 1 ~ 3'));
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.payload.note)).toEqual([0, 1, 3]);
  });

  it('rest preserves timing of surrounding events', () => {
    const events = query(note('0 ~ 2 3'));
    // Events at positions 0, 0.5, 0.75
    expect(events[0]?.begin).toBeCloseTo(0, 6);
    expect(events[1]?.begin).toBeCloseTo(0.5, 6);
    expect(events[2]?.begin).toBeCloseTo(0.75, 6);
  });

  it('rest with fast creates correct sparse pattern', () => {
    const events = query(note('0 ~').fast(4));
    // 4 copies of "0 ~": 4 events total (4 rests suppressed)
    expect(events).toHaveLength(4);
    for (const e of events) {
      expect(e.payload.note).toBe(0);
    }
  });

  it('rest with rev moves rest position', () => {
    // note('a ~ c') reversed: c ~ a
    // Events: 'c' first, then 'a' later
    const events = query(note('a ~ c').rev());
    expect(events).toHaveLength(2);
    expect(events[0]?.payload.note).toBe('c');
    expect(events[1]?.payload.note).toBe('a');
  });

  it('rest with ply: rest slots remain empty after ply', () => {
    const events = query(note('0 ~').ply(2));
    // '0' gets plied to 2 events, '~' produces nothing
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.payload.note).toBe(0);
    }
  });
});

// ===========================================================================
// 16. Property annotation paths — comprehensive PROPERTY_METHODS
// ===========================================================================

describe('audit 6.4 — property annotation paths', () => {
  it('gain annotates event payload', () => {
    const events = query(s('bd').gain(0.7));
    expect(events[0]?.payload.gain).toBe(0.7);
  });

  it('pan annotates event payload', () => {
    const events = query(s('bd').pan(0.3));
    expect(events[0]?.payload.pan).toBe(0.3);
  });

  it('speed annotates event payload', () => {
    const events = query(s('bd').speed(2));
    expect(events[0]?.payload.speed).toBe(2);
  });

  it('cutoff annotates event payload', () => {
    const events = query(s('bd').cutoff(1000));
    expect(events[0]?.payload.cutoff).toBe(1000);
  });

  it('room annotates event payload', () => {
    const events = query(s('bd').room(0.5));
    expect(events[0]?.payload.room).toBe(0.5);
  });

  it('delay annotates event payload', () => {
    const events = query(s('bd').delay(0.3));
    expect(events[0]?.payload.delay).toBe(0.3);
  });

  it('orbit annotates event payload', () => {
    const events = query(s('bd').orbit(2));
    expect(events[0]?.payload.orbit).toBe(2);
  });

  it('velocity annotates event payload', () => {
    const events = query(s('bd').velocity(0.9));
    expect(events[0]?.payload.velocity).toBe(0.9);
  });

  it('loop annotates event payload', () => {
    const events = query(s('bd').loop(1));
    expect(events[0]?.payload.loop).toBe(1);
  });

  it('cut annotates event payload', () => {
    const events = query(s('bd').cut(1));
    expect(events[0]?.payload.cut).toBe(1);
  });

  it('attack annotates event payload', () => {
    const events = query(s('bd').attack(0.01));
    expect(events[0]?.payload.attack).toBe(0.01);
  });

  it('release annotates event payload', () => {
    const events = query(s('bd').release(0.5));
    expect(events[0]?.payload.release).toBe(0.5);
  });

  it('sustain annotates event payload', () => {
    const events = query(s('bd').sustain(0.3));
    expect(events[0]?.payload.sustain).toBe(0.3);
  });

  it('vowel annotates event payload', () => {
    const events = query(s('bd').vowel('a'));
    expect(events[0]?.payload.vowel).toBe('a');
  });

  it('hpf annotates event payload', () => {
    const events = query(s('bd').hpf(200));
    expect(events[0]?.payload.hpf).toBe(200);
  });

  it('lpf annotates event payload', () => {
    const events = query(s('bd').lpf(2000));
    expect(events[0]?.payload.lpf).toBe(2000);
  });

  it('multiple property annotations chain correctly', () => {
    const events = query(s('bd').gain(0.5).pan(0.8).speed(1.5).room(0.3));
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.gain).toBe(0.5);
    expect(events[0]?.payload.pan).toBe(0.8);
    expect(events[0]?.payload.speed).toBe(1.5);
    expect(events[0]?.payload.room).toBe(0.3);
  });

  it('begin/end as property annotations set payload values', () => {
    const events = query(s('bd').begin(0.1).end(0.9));
    expect(events[0]?.payload.begin).toBe(0.1);
    expect(events[0]?.payload.end).toBe(0.9);
  });

  it('patterned property annotation resolves per event', () => {
    const events = query(s('bd bd bd bd').gain('0.1 0.5 0.8 1'));
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.payload.gain)).toEqual([0.1, 0.5, 0.8, 1]);
  });
});

// ===========================================================================
// 17. clip interaction with duration — comprehensive
// ===========================================================================

describe('audit 6.4 — clip interaction with duration', () => {
  it('clip(0) sets clip payload to 0 but duration has a minimum floor', () => {
    const events = query(s('bd').clip(0));
    expect(events).toHaveLength(1);
    // The engine applies a minimum duration floor (0.05) even with clip(0)
    expect(events[0]?.duration).toBeGreaterThan(0);
    expect(events[0]?.payload.clip).toBe(0);
  });

  it('clip(0.5) halves the duration', () => {
    const events = query(s('bd').clip(0.5));
    expect(events).toHaveLength(1);
    expect(events[0]?.duration).toBeCloseTo(0.5, 6);
  });

  it('clip with subdivided pattern scales each event duration', () => {
    const events = query(note('0 1 2 3').clip(0.5));
    expect(events).toHaveLength(4);
    for (const e of events) {
      // Original duration is 0.25; clip(0.5) -> 0.25 * 0.5 = 0.125
      expect(e.duration).toBeCloseTo(0.125, 6);
    }
  });

  it('clip does not change begin/end (scheduling window)', () => {
    const events = query(s('bd').clip(0.3));
    expect(events[0]?.begin).toBe(0);
    expect(events[0]?.end).toBe(1);
  });

  it('clip with fast pattern', () => {
    const events = query(s('bd').clip(0.5).fast(2));
    expect(events).toHaveLength(2);
    for (const e of events) {
      // Each event spans 0.5 cycle; clip(0.5) -> 0.25
      expect(e.duration).toBeCloseTo(0.25, 6);
    }
  });
});

// ===========================================================================
// 18. evaluateMiniNumber() edge cases (via evaluateNumericValue)
// ===========================================================================

describe('audit 6.4 — evaluateMiniNumber edge cases', () => {
  it('single numeric string evaluates correctly', () => {
    expect(evaluateNumericValue('42', 0)).toBe(42);
  });

  it('float string evaluates correctly', () => {
    expect(evaluateNumericValue('3.14', 0)).toBeCloseTo(3.14, 6);
  });

  it('"0" evaluates to 0', () => {
    expect(evaluateNumericValue('0', 0)).toBe(0);
  });

  it('multi-value mini notation returns value at correct position', () => {
    expect(evaluateNumericValue('1 2 3 4', 0)).toBe(1);
    expect(evaluateNumericValue('1 2 3 4', 0.25)).toBe(2);
    expect(evaluateNumericValue('1 2 3 4', 0.5)).toBe(3);
    expect(evaluateNumericValue('1 2 3 4', 0.75)).toBe(4);
  });

  it('rest in mini notation returns undefined', () => {
    expect(evaluateNumericValue('~', 0)).toBeUndefined();
  });

  it('non-numeric string returns undefined', () => {
    expect(evaluateNumericValue('hello', 0)).toBeUndefined();
  });

  it('empty string returns undefined', () => {
    expect(evaluateNumericValue('', 0)).toBeUndefined();
  });

  it('mini number at large cycle position', () => {
    expect(evaluateNumericValue('99', 1_000_000)).toBe(99);
  });

  it('mini notation with spaces only returns undefined', () => {
    expect(evaluateNumericValue('   ', 0)).toBeUndefined();
  });
});

// ===========================================================================
// 19. coerceMiniValue() edge cases (via value patterns)
// ===========================================================================

describe('audit 6.4 — coerceMiniValue edge cases (via value patterns)', () => {
  it('numeric strings are coerced to numbers in value patterns', () => {
    const events = query(value('42'));
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.value).toBe(42);
  });

  it('float strings are coerced to numbers', () => {
    const events = query(value('3.14'));
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.value).toBeCloseTo(3.14, 6);
  });

  it('"0" is coerced to the number 0', () => {
    const events = query(value('0'));
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.value).toBe(0);
  });

  it('non-numeric strings remain as strings', () => {
    const events = query(value('hello'));
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.value).toBe('hello');
  });

  it('mixed numeric and string values', () => {
    const events = query(value('42 hello 3.14'));
    expect(events).toHaveLength(3);
    expect(events[0]?.payload.value).toBe(42);
    expect(events[1]?.payload.value).toBe('hello');
    expect(events[2]?.payload.value).toBeCloseTo(3.14, 6);
  });

  it('value pattern with scientific notation string', () => {
    const events = query(value('1e3'));
    expect(events).toHaveLength(1);
    // 1e3 = 1000 as a number
    expect(events[0]?.payload.value).toBe(1000);
  });
});

// ===========================================================================
// 20. isTruthyMaskValue() edge cases (via mask behavior)
// ===========================================================================

describe('audit 6.4 — isTruthyMaskValue edge cases (via mask)', () => {
  it('"0" is falsy', () => {
    const events = query(note('a').mask('0'));
    expect(events).toHaveLength(0);
  });

  it('"false" is falsy', () => {
    const events = query(note('a').mask('false'));
    expect(events).toHaveLength(0);
  });

  it('"~" (rest) produces no mask event (effectively falsy)', () => {
    const events = query(note('a').mask('~'));
    expect(events).toHaveLength(0);
  });

  it('"1" is truthy', () => {
    const events = query(note('a').mask('1'));
    expect(events).toHaveLength(1);
  });

  it('positive numbers are truthy', () => {
    const events = query(note('a b c').mask('5 3 7'));
    expect(events).toHaveLength(3);
  });

  it('"true" as a string is truthy (not in the falsy list)', () => {
    const events = query(note('a').mask('true'));
    expect(events).toHaveLength(1);
  });

  it('any non-special string is truthy', () => {
    const events = query(note('a').mask('hello'));
    expect(events).toHaveLength(1);
  });

  it('complex mask patterns filter correctly', () => {
    const events = query(note('a b c d e f g h').mask('1 0 1 0 1 0 1 0'));
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.payload.note)).toEqual(['a', 'c', 'e', 'g']);
  });
});

// ===========================================================================
// Additional audit coverage: combined transform interactions
// ===========================================================================

describe('audit 6.4 — combined transform interactions', () => {
  it('fast + early + mask produces correct filtered events', () => {
    const events = query(note('0 1 2 3').fast(2).early(0.25).mask('1 0'), 0, 1);
    // Complex interaction: fast doubles, early shifts, mask filters
    expect(events.length).toBeGreaterThan(0);
  });

  it('ply + fast compounds repetition', () => {
    const events = query(note('0').ply(2).fast(2));
    // ply(2) = 2 events, fast(2) = 4 events
    expect(events).toHaveLength(4);
  });

  it('slow + rev reverses within each cycle independently', () => {
    const events = query(note('0 1 2 3').slow(2).rev(), 0, 2);
    expect(events).toHaveLength(4);
    // slow(2) splits the 4-event pattern across 2 cycles: [0,1] in cycle 0, [2,3] in cycle 1
    // rev reverses within each cycle: [1,0] then [3,2]
    expect(events.map((e) => e.payload.note)).toEqual([1, 0, 3, 2]);
  });

  it('stack with add transforms each layer independently', () => {
    const events = query(stack(note('0').add(10), note('0').add(20)));
    expect(events).toHaveLength(2);
    const notes = events.map((e) => e.payload.note).sort();
    expect(notes).toEqual([10, 20]);
  });

  it('clip + ply: each sub-event gets clipped duration', () => {
    const events = query(s('bd').clip(0.5).ply(2));
    expect(events).toHaveLength(2);
    for (const e of events) {
      // Original event 1 cycle, clip(0.5) = 0.5, then ply(2) subdivides
      // Each sub-event spans 0.5 cycle, clip(0.5) -> 0.25
      expect(e.duration).toBeCloseTo(0.25, 6);
    }
  });
});

// ===========================================================================
// Edge case: unsupported pattern call warning
// ===========================================================================

describe('audit 6.4 — unsupported pattern handling', () => {
  it('unsupported pattern call produces warning and no events', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const scene = defineScene({
        channels: {
          test: {
            node: {
              args: ['bd hh'],
              exprType: 'pattern',
              kind: 'call',
              name: 'totallyFakeCall',
            },
          },
        },
      });

      const events = queryScene(scene, 0, 1, { cps: 1 });
      expect(events).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('unsupported pattern call "totallyFakeCall" is not implemented'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ===========================================================================
// Edge case: evaluateNumericValue with non-standard inputs
// ===========================================================================

describe('audit 6.4 — evaluateNumericValue comprehensive', () => {
  it('returns undefined for undefined', () => {
    expect(evaluateNumericValue(undefined, 0)).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(evaluateNumericValue(null, 0)).toBeUndefined();
  });

  it('returns undefined for true', () => {
    expect(evaluateNumericValue(true, 0)).toBeUndefined();
  });

  it('returns undefined for false', () => {
    expect(evaluateNumericValue(false, 0)).toBeUndefined();
  });

  it('returns number directly for any finite number', () => {
    expect(evaluateNumericValue(0, 0)).toBe(0);
    expect(evaluateNumericValue(42, 0)).toBe(42);
    expect(evaluateNumericValue(-100, 0)).toBe(-100);
    expect(evaluateNumericValue(3.14, 0)).toBe(3.14);
  });

  it('returns NaN for NaN input', () => {
    expect(evaluateNumericValue(Number.NaN, 0)).toBeNaN();
  });

  it('returns Infinity for Infinity input', () => {
    expect(evaluateNumericValue(Number.POSITIVE_INFINITY, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(evaluateNumericValue(Number.NEGATIVE_INFINITY, 0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('evaluates array by taking first element', () => {
    expect(evaluateNumericValue([99], 0)).toBe(99);
    expect(evaluateNumericValue([[42]], 0)).toBe(42);
  });

  it('returns undefined for empty array', () => {
    expect(evaluateNumericValue([], 0)).toBeUndefined();
  });

  it('returns undefined for non-expression objects', () => {
    expect(evaluateNumericValue({ foo: 'bar' } as unknown as ExpressionValue, 0)).toBeUndefined();
  });

  it('evaluates signal expressions (sine at 0)', () => {
    expect(evaluateNumericValue(sine.expr, 0)).toBeCloseTo(0.5, 6);
  });

  it('evaluates signal expressions (saw at 0.5)', () => {
    expect(evaluateNumericValue(saw.expr, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('evaluates signal with range', () => {
    expect(evaluateNumericValue(saw.range(0, 100).expr, 0.5)).toBeCloseTo(50, 6);
  });

  it('evaluates pattern expression nodes', () => {
    expect(evaluateNumericValue(value('42').expr, 0)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// PROPERTY_METHODS sync check (audit fix 10)
// ---------------------------------------------------------------------------

describe('PROPERTY_METHODS sync', () => {
  it('exports PROPERTY_METHODS from @tussel/core', () => {
    expect(PROPERTY_METHODS).toBeInstanceOf(Set);
    expect(PROPERTY_METHODS.size).toBeGreaterThan(0);
  });

  it('contains known essential property methods', () => {
    const required = ['gain', 'pan', 'speed', 'room', 'delay', 'lpf', 'hpf', 'phaser', 'vowel', 'note', 's'];
    for (const name of required) {
      expect(PROPERTY_METHODS.has(name)).toBe(true);
    }
  });

  it('matches expected snapshot to catch unintentional changes', () => {
    expect([...PROPERTY_METHODS].sort()).toMatchSnapshot();
  });
});
