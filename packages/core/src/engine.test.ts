import { collectExternalDispatches, queryScene } from '@tussel/core';
import {
  add,
  cat,
  defineScene,
  n,
  note,
  type PatternBuilder,
  perlin,
  rand,
  rev,
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
import type { ExpressionValue, SceneSpec } from '@tussel/ir';
import { describe, expect, it, vi } from 'vitest';
import { evaluateNumericValue } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScene(node: unknown, channel = 'lead') {
  return defineScene({
    channels: { [channel]: { node: node as import('@tussel/ir').ExpressionValue } },
  });
}

function query(node: unknown, begin = 0, end = 1, channel = 'lead') {
  return queryScene(makeScene(node, channel), begin, end, { cps: 1 });
}

function roundEvents(events: ReturnType<typeof queryScene>, digits = 9) {
  return events.map((e) => ({
    ...e,
    begin: Number(e.begin.toFixed(digits)),
    duration: Number(e.duration.toFixed(digits)),
    end: Number(e.end.toFixed(digits)),
  }));
}

// ---------------------------------------------------------------------------
// 1. stack composition
// ---------------------------------------------------------------------------
describe('stack composition', () => {
  it('produces events from all stacked patterns in one cycle', () => {
    const events = query(stack(note('c'), note('e'), note('g')));
    expect(events).toHaveLength(3);
    const notes = events.map((e) => e.payload.note);
    expect(notes).toEqual(expect.arrayContaining(['c', 'e', 'g']));
  });

  it('preserves timing: all stacked events span the full cycle', () => {
    const events = query(stack(note('c'), note('e')));
    for (const e of events) {
      expect(e.begin).toBe(0);
      expect(e.end).toBe(1);
    }
  });

  it('stacks patterns with different subdivisions', () => {
    const events = query(stack(note('0 1'), note('2 3 4')));
    // 2 events from first + 3 from second
    expect(events).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// 2. fast transforms
// ---------------------------------------------------------------------------
describe('fast transforms', () => {
  it('doubles the number of events when fast(2)', () => {
    const normal = query(note('0 1'));
    const fast2 = query(note('0 1').fast(2));
    expect(fast2).toHaveLength(normal.length * 2);
  });

  it('halves event durations when fast(2)', () => {
    const events = query(note('0').fast(2));
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.duration).toBeCloseTo(0.5, 6);
    }
  });

  it('fast(1) is identity', () => {
    const plain = query(note('0 1'));
    const fast1 = query(note('0 1').fast(1));
    expect(fast1).toEqual(plain);
  });
});

// ---------------------------------------------------------------------------
// 3. slow transforms
// ---------------------------------------------------------------------------
describe('slow transforms', () => {
  it('slow(2) stretches events to 2 cycles', () => {
    const events = query(note('0 1').slow(2), 0, 2);
    // Over 2 cycles we get the same number of events as 1 cycle unslowed
    expect(events).toHaveLength(2);
    expect(events[0]?.duration).toBeCloseTo(1, 6);
  });

  it('slow(2) querying only cycle 0..1 yields one event', () => {
    const events = query(note('0 1').slow(2), 0, 1);
    expect(events).toHaveLength(1);
  });

  it('slow(1) is identity', () => {
    const plain = query(note('0 1'));
    const slow1 = query(note('0 1').slow(1));
    expect(slow1).toEqual(plain);
  });
});

// ---------------------------------------------------------------------------
// 4. early shifts
// ---------------------------------------------------------------------------
describe('early shifts', () => {
  it('shifts events earlier in time by the given amount', () => {
    // note('0 1') has two events: [0,0.5) and [0.5,1).
    // early(0.25) shifts them to [-0.25,0.25) and [0.25,0.75).
    // The query also picks up wrapped events from the adjacent cycle.
    const events = query(note('0 1').early(0.25), 0, 1);
    // The second event should start at 0.25
    const shifted = events.find((e) => e.payload.note === 1);
    expect(shifted).toBeDefined();
    expect(shifted?.begin).toBeCloseTo(0.25, 6);
  });

  it('early(0) is identity', () => {
    const plain = query(note('0 1'));
    const early0 = query(note('0 1').early(0));
    expect(early0).toEqual(plain);
  });
});

// ---------------------------------------------------------------------------
// 5. late shifts
// ---------------------------------------------------------------------------
describe('late shifts', () => {
  it('shifts events later in time by the given amount', () => {
    // note('0 1') has events at [0,0.5) and [0.5,1).
    // late(0.25) shifts them to [0.25,0.75) and [0.75,1.25).
    const events = query(note('0 1').late(0.25), 0, 1);
    const shifted = events.find((e) => e.payload.note === 0);
    expect(shifted).toBeDefined();
    expect(shifted?.begin).toBeCloseTo(0.25, 6);
  });

  it('late(0) is identity', () => {
    const plain = query(note('0 1'));
    const late0 = query(note('0 1').late(0));
    expect(late0).toEqual(plain);
  });
});

// ---------------------------------------------------------------------------
// 6. ply repetition
// ---------------------------------------------------------------------------
describe('ply repetition', () => {
  it('repeats each event within its time span', () => {
    const events = query(note('0 1').ply(2));
    expect(events).toHaveLength(4);
    expect(events.map((e) => [e.begin, e.payload.note])).toEqual([
      [0, 0],
      [0.25, 0],
      [0.5, 1],
      [0.75, 1],
    ]);
  });

  it('ply(1) is identity in count', () => {
    const events = query(note('0 1').ply(1));
    expect(events).toHaveLength(2);
  });

  it('ply(3) triples events', () => {
    const events = query(note('0').ply(3));
    expect(events).toHaveLength(3);
    // All events carry the same payload
    for (const e of events) {
      expect(e.payload.note).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. rev reversal
// ---------------------------------------------------------------------------
describe('rev reversal', () => {
  it('reverses event order within a cycle', () => {
    const events = query(note('0 1 2 3').rev());
    expect(events.map((e) => e.payload.note)).toEqual([3, 2, 1, 0]);
  });

  it('rev of a single event preserves it', () => {
    const events = query(note('0').rev());
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.note).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. mask / struct filtering
// ---------------------------------------------------------------------------
describe('mask / struct filtering', () => {
  it('mask filters events by truthy mask values', () => {
    const events = query(s('bd bd bd bd').mask('1 0 1 0'));
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.begin)).toEqual([0, 0.5]);
  });

  it('struct filters the same way as mask', () => {
    const events = query(s('bd bd bd bd').struct('1 0 1 0'));
    expect(events).toHaveLength(2);
  });

  it('mask with all truthy values passes everything through', () => {
    const events = query(s('bd bd bd bd').mask('1 1 1 1'));
    expect(events).toHaveLength(4);
  });

  it('mask with all falsy values removes everything', () => {
    const events = query(s('bd bd bd bd').mask('0 0 0 0'));
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Signal evaluation: sine, tri, square, rand, perlin
// ---------------------------------------------------------------------------
describe('signal evaluation', () => {
  it('sine ranges [0,1] and starts at 0.5', () => {
    expect(evaluateNumericValue(sine.expr, 0)).toBeCloseTo(0.5, 6);
    expect(evaluateNumericValue(sine.expr, 0.25)).toBeCloseTo(1, 6);
    expect(evaluateNumericValue(sine.expr, 0.5)).toBeCloseTo(0.5, 6);
    expect(evaluateNumericValue(sine.expr, 0.75)).toBeCloseTo(0, 6);
  });

  it('tri ranges [0,1] with peak at 0.25', () => {
    expect(evaluateNumericValue(tri.expr, 0)).toBeCloseTo(0, 6);
    expect(evaluateNumericValue(tri.expr, 0.25)).toBeCloseTo(0.5, 6);
    expect(evaluateNumericValue(tri.expr, 0.5)).toBeCloseTo(1, 6);
    expect(evaluateNumericValue(tri.expr, 0.75)).toBeCloseTo(0.5, 6);
  });

  it('square is 0 in first half, 1 in second half', () => {
    expect(evaluateNumericValue(square.expr, 0)).toBe(0);
    expect(evaluateNumericValue(square.expr, 0.25)).toBe(0);
    expect(evaluateNumericValue(square.expr, 0.5)).toBe(1);
    expect(evaluateNumericValue(square.expr, 0.75)).toBe(1);
  });

  it('rand produces values in [0,1)', () => {
    for (let c = 0; c < 10; c += 0.1) {
      const v = evaluateNumericValue(rand.expr, c)!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('rand is deterministic for the same cycle', () => {
    const a = evaluateNumericValue(rand.expr, 3.7);
    const b = evaluateNumericValue(rand.expr, 3.7);
    expect(a).toBe(b);
  });

  it('perlin produces smooth values in [0,1]', () => {
    for (let c = 0; c < 5; c += 0.25) {
      const v = evaluateNumericValue(perlin.expr, c)!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('perlin is deterministic', () => {
    expect(evaluateNumericValue(perlin.expr, 2.5)).toBe(evaluateNumericValue(perlin.expr, 2.5));
  });
});

// ---------------------------------------------------------------------------
// 10. Signal arithmetic operators
// ---------------------------------------------------------------------------
describe('signal arithmetic operators', () => {
  it('add offsets signal values', () => {
    expect(evaluateNumericValue(saw.add(10).expr, 0)).toBeCloseTo(10, 6);
    expect(evaluateNumericValue(saw.add(10).expr, 0.5)).toBeCloseTo(10.5, 6);
  });

  it('mul scales signal values', () => {
    expect(evaluateNumericValue(saw.mul(2).expr, 0.5)).toBeCloseTo(1, 6);
    expect(evaluateNumericValue(saw.mul(0).expr, 0.5)).toBeCloseTo(0, 6);
  });

  it('sub subtracts from signal values', () => {
    expect(evaluateNumericValue(saw.sub(0.5).expr, 0.5)).toBeCloseTo(0, 6);
  });

  it('div divides signal values', () => {
    expect(evaluateNumericValue(saw.mul(4).div(2).expr, 0.5)).toBeCloseTo(1, 6);
  });

  it('range remaps signal from [0,1] to [min,max]', () => {
    expect(evaluateNumericValue(saw.range(10, 20).expr, 0)).toBeCloseTo(10, 6);
    expect(evaluateNumericValue(saw.range(10, 20).expr, 0.5)).toBeCloseTo(15, 6);
    expect(evaluateNumericValue(saw.range(10, 20).expr, 1)).toBeCloseTo(10, 4);
  });
});

// ---------------------------------------------------------------------------
// 11. Nested pattern composition
// ---------------------------------------------------------------------------
describe('nested pattern composition', () => {
  it('nesting seq inside stack merges subdivisions', () => {
    const events = query(stack(note(seq('c', 'e')), note(seq('g', 'b', 'd'))));
    expect(events).toHaveLength(5);
  });

  it('nesting cat inside fast multiplies cycle count', () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: {
            args: [{ note: 'c' }, { note: 'e' }],
            exprType: 'pattern',
            kind: 'call',
            name: 'cat',
          },
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    // cat with 2 entries over 4 cycles: c, e, c, e
    const events = queryScene(scene, 0, 4, { cps: 1 });
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.payload.note)).toEqual(['c', 'e', 'c', 'e']);
  });
});

// ---------------------------------------------------------------------------
// 12. Negative cycle ranges
// ---------------------------------------------------------------------------
describe('negative cycle ranges', () => {
  it('allows querying negative cycle ranges', () => {
    const events = query(note('0 1'), -1, 0);
    expect(events).toHaveLength(2);
    expect(events[0]?.begin).toBe(-1);
  });

  it('negative to positive span covers multiple cycles', () => {
    const events = query(note('0'), -1, 1);
    expect(events).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 13. Very large cycle numbers
// ---------------------------------------------------------------------------
describe('very large cycle numbers', () => {
  it('returns events at high cycle counts', () => {
    const events = query(note('0 1'), 1_000_000, 1_000_001);
    expect(events).toHaveLength(2);
  });

  it('cat wraps around at large cycle numbers', () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: {
            args: [{ note: 'c' }, { note: 'e' }, { note: 'g' }],
            exprType: 'pattern',
            kind: 'call',
            name: 'cat',
          },
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    // Cycle 999999 mod 3 => 0 => 'c'
    const events = queryScene(scene, 999_999, 1_000_000, { cps: 1 });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.note).toBe('c');
  });
});

// ---------------------------------------------------------------------------
// 14. Empty patterns - silence
// ---------------------------------------------------------------------------
describe('empty patterns', () => {
  it('silence produces no events', () => {
    const events = query(silence());
    expect(events).toHaveLength(0);
  });

  it('stack with silence and a pattern only produces pattern events', () => {
    const events = query(stack(silence(), note('c')));
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.note).toBe('c');
  });
});

// ---------------------------------------------------------------------------
// 15. Patterns with rests (mini notation ~)
// ---------------------------------------------------------------------------
describe('patterns with rests', () => {
  it('rest (~) suppresses events in that slot', () => {
    const events = query(note('0 ~ 2'));
    expect(events).toHaveLength(2);
    const notes = events.map((e) => e.payload.note);
    expect(notes).toEqual([0, 2]);
  });

  it('all rests produce no events', () => {
    const events = query(note('~ ~ ~'));
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 16. clip as property annotation
// ---------------------------------------------------------------------------
describe('clip property annotation', () => {
  it('clip scales the event duration but keeps begin/end span', () => {
    const events = query(s('bd').clip(0.5));
    expect(events).toHaveLength(1);
    const e = events[0]!;
    // begin and end remain 0..1 for the event scheduling window
    expect(e.begin).toBe(0);
    expect(e.end).toBe(1);
    // duration is scaled by clip
    expect(e.duration).toBeCloseTo(0.5, 6);
    expect(e.payload.clip).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// 17. evaluateNumericValue edge cases
// ---------------------------------------------------------------------------
describe('evaluateNumericValue edge cases', () => {
  it('returns undefined for undefined', () => {
    expect(evaluateNumericValue(undefined, 0)).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(evaluateNumericValue(null, 0)).toBeUndefined();
  });

  it('returns undefined for boolean', () => {
    expect(evaluateNumericValue(true, 0)).toBeUndefined();
    expect(evaluateNumericValue(false, 0)).toBeUndefined();
  });

  it('evaluates first element of arrays', () => {
    const result = evaluateNumericValue([42], 0);
    expect(result).toBeDefined();
    expect(result).toBe(42);
  });

  it('returns number directly', () => {
    expect(evaluateNumericValue(7, 0)).toBe(7);
  });

  it('parses numeric strings via mini notation', () => {
    expect(evaluateNumericValue('3', 0)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 18. segment - resegmentation
// ---------------------------------------------------------------------------
describe('segment resegmentation', () => {
  it('segments a signal into discrete steps', () => {
    const events = query(note(sine.range(0, 4)).segment(4));
    expect(events).toHaveLength(4);
    const rounded = events.map((e) => Number((e.payload.note as number).toFixed(6)));
    expect(rounded).toEqual([2, 4, 2, 0]);
  });

  it('segment(1) produces one event per cycle', () => {
    const events = query(note(sine.range(0, 10)).segment(1));
    expect(events).toHaveLength(1);
  });

  it('segment(8) produces 8 events per cycle', () => {
    const events = query(note(sine.range(0, 10)).segment(8));
    expect(events).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// 19. chunk - chunking transform
// ---------------------------------------------------------------------------
describe('chunk transform', () => {
  it('applies transform to one chunk per cycle, rotating', () => {
    const events = query(note('0 1 2 3').chunk(4, add(7)), 0, 4);
    const notes = events.map((e) => e.payload.note).filter((v): v is number => typeof v === 'number');
    expect(notes).toEqual([7, 1, 2, 3, 0, 8, 2, 3, 0, 1, 9, 3, 0, 1, 2, 10]);
  });

  it('chunk(1) applies transform to whole pattern every cycle', () => {
    const events = query(note('0 1').chunk(1, add(10)));
    const notes = events.map((e) => e.payload.note);
    expect(notes).toEqual([10, 11]);
  });
});

// ---------------------------------------------------------------------------
// 20. degrade / degradeBy
// ---------------------------------------------------------------------------
describe('degrade / degradeBy', () => {
  it('degradeBy(1) removes all events', () => {
    const events = query(s('bd bd bd bd').degradeBy(1));
    expect(events).toHaveLength(0);
  });

  it('degradeBy(0) keeps all events', () => {
    const events = query(s('bd bd bd bd').degradeBy(0));
    expect(events).toHaveLength(4);
  });

  it('degrade is deterministic', () => {
    const scene = makeScene(s('bd bd bd bd bd bd bd bd').degrade());
    const a = queryScene(scene, 0, 1, { cps: 1 }).map((e) => e.begin);
    const b = queryScene(scene, 0, 1, { cps: 1 }).map((e) => e.begin);
    expect(a).toEqual(b);
  });

  it('degradeBy(0.5) removes roughly half the events', () => {
    const events = query(s('bd bd bd bd').degradeBy(0.5));
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThan(4);
  });
});

// ---------------------------------------------------------------------------
// 21. scramble / shuffle
// ---------------------------------------------------------------------------
describe('scramble / shuffle rearrangement', () => {
  it('shuffle produces a permutation of the original events', () => {
    const events = query(note('0 1 2 3').shuffle(4));
    const notes = events.map((e) => e.payload.note);
    expect([...notes].sort()).toEqual([0, 1, 2, 3]);
    expect(notes).toHaveLength(4);
  });

  it('shuffle is deterministic', () => {
    const scene = makeScene(note('0 1 2 3').shuffle(4));
    const a = queryScene(scene, 0, 1, { cps: 1 }).map((e) => e.payload.note);
    const b = queryScene(scene, 0, 1, { cps: 1 }).map((e) => e.payload.note);
    expect(a).toEqual(b);
  });

  it('scramble picks from original slices (may repeat)', () => {
    const events = query(note('0 1 2 3').scramble(4));
    expect(events).toHaveLength(4);
    for (const e of events) {
      expect([0, 1, 2, 3]).toContain(e.payload.note);
    }
  });

  it('scramble is deterministic', () => {
    const scene = makeScene(note('0 1 2 3').scramble(4));
    const a = queryScene(scene, 0, 1, { cps: 1 }).map((e) => e.payload.note);
    const b = queryScene(scene, 0, 1, { cps: 1 }).map((e) => e.payload.note);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// 22. every / when / sometimesBy / within
// ---------------------------------------------------------------------------
describe('every / when / sometimesBy / within', () => {
  it('every(2, ...) applies transform only on even cycles', () => {
    const scene = makeScene(note('0 1').every(2, (p: PatternBuilder) => p.add(12)));
    const events = queryScene(scene, 0, 2, { cps: 1 });
    expect(events.map((e) => e.payload.note)).toEqual([12, 13, 0, 1]);
  });

  it('when applies transform when mask is truthy', () => {
    const scene = makeScene(note('0 1').when('0 1', (p: PatternBuilder) => p.add(7)));
    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.map((e) => e.payload.note)).toEqual([0, 8]);
  });

  it('sometimesBy(0) never applies transform', () => {
    const events = query(note('0 1 2 3').sometimesBy(0, rev));
    expect(events.map((e) => e.payload.note)).toEqual([0, 1, 2, 3]);
  });

  it('sometimesBy(1) always applies transform', () => {
    const events = query(note('0 1 2 3').sometimesBy(1, rev));
    expect(events.map((e) => e.payload.note)).toEqual([3, 2, 1, 0]);
  });

  it('within applies transform only to a portion of the cycle', () => {
    const events = query(note('0 1').within(0, 0.5, add(12)));
    expect(events.map((e) => [e.begin, e.payload.note])).toEqual([
      [0, 12],
      [0.5, 1],
    ]);
  });
});

// ---------------------------------------------------------------------------
// 23. zoom / compress
// ---------------------------------------------------------------------------
describe('zoom / compress', () => {
  it('zoom extracts a window of the pattern and stretches to fill cycle', () => {
    const events = query(note('0 1 2 3').zoom(0.25, 0.75));
    expect(events.map((e) => [e.begin, e.end, e.payload.note])).toEqual([
      [0, 0.5, 1],
      [0.5, 1, 2],
    ]);
  });

  it('compress fits the entire pattern into a sub-window', () => {
    const events = query(note('0 1 2 3').compress(0.25, 0.75));
    expect(events.map((e) => [e.begin, e.end, e.payload.note])).toEqual([
      [0.25, 0.375, 0],
      [0.375, 0.5, 1],
      [0.5, 0.625, 2],
      [0.625, 0.75, 3],
    ]);
  });

  it('zoom(0,1) is identity', () => {
    const plain = query(note('0 1'));
    const zoomed = query(note('0 1').zoom(0, 1));
    expect(zoomed).toEqual(plain);
  });

  it('compress(0,1) is identity', () => {
    const plain = query(note('0 1'));
    const compressed = query(note('0 1').compress(0, 1));
    expect(compressed).toEqual(plain);
  });
});

// ---------------------------------------------------------------------------
// 24. transpose / scale / scaleTranspose
// ---------------------------------------------------------------------------
describe('transpose / scale / scaleTranspose', () => {
  it('transpose shifts note names by semitones', () => {
    const events = query(note('C4 E4').transpose(12));
    expect(events.map((e) => e.payload.note)).toEqual(['C5', 'E5']);
  });

  it('transpose shifts numeric notes by amount', () => {
    const events = query(note('0 2').transpose(7));
    expect(events.map((e) => e.payload.note)).toEqual([7, 9]);
  });

  it('scale maps degree numbers to scale notes', () => {
    const events = query(value('0 2 4').scale('C:major').note());
    expect(events.map((e) => e.payload.note)).toEqual(['C3', 'E3', 'G3']);
  });

  it('scaleTranspose shifts within the scale', () => {
    const events = query(value('0 1 2').scale('C:major').scaleTranspose(2).note());
    expect(events.map((e) => e.payload.note)).toEqual(['E3', 'F3', 'G3']);
  });
});

// ---------------------------------------------------------------------------
// 25. collectExternalDispatches - MIDI and OSC
// ---------------------------------------------------------------------------
describe('collectExternalDispatches', () => {
  it('generates a MIDI note dispatch when midichan is set', () => {
    const event = {
      begin: 0,
      channel: 'lead',
      duration: 1,
      end: 1,
      payload: { note: 60, midichan: 1 },
    };
    const dispatches = collectExternalDispatches(event);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.kind).toBe('midi-note');
    if (dispatches[0]?.kind === 'midi-note') {
      expect(dispatches[0]?.channelNumber).toBe(1);
    }
  });

  it('generates MIDI CC dispatch when midicc is set', () => {
    const event = {
      begin: 0,
      channel: 'lead',
      duration: 1,
      end: 1,
      payload: { midicc: 74, midivalue: 100 },
    };
    const dispatches = collectExternalDispatches(event);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.kind).toBe('midi-cc');
  });

  it('generates OSC dispatch when osc path is set', () => {
    const event = {
      begin: 0,
      channel: 'lead',
      duration: 1,
      end: 1,
      payload: { osc: '/test', oscport: 9000 },
    };
    const dispatches = collectExternalDispatches(event);
    const oscDispatches = dispatches.filter((d) => d.kind === 'osc');
    expect(oscDispatches).toHaveLength(1);
    if (oscDispatches[0]?.kind === 'osc') {
      expect(oscDispatches[0]?.path).toBe('/test');
      expect(oscDispatches[0]?.port).toBe(9000);
    }
  });

  it('generates OSC dispatch when oschost is set even without osc path', () => {
    const event = {
      begin: 0,
      channel: 'drums',
      duration: 1,
      end: 1,
      payload: { oschost: '192.168.1.1' },
    };
    const dispatches = collectExternalDispatches(event);
    const oscDispatches = dispatches.filter((d) => d.kind === 'osc');
    expect(oscDispatches).toHaveLength(1);
    if (oscDispatches[0]?.kind === 'osc') {
      expect(oscDispatches[0]?.path).toBe('/drums');
    }
  });

  it('returns no dispatches for muted events', () => {
    const event = {
      begin: 0,
      channel: 'lead',
      duration: 1,
      end: 1,
      payload: { note: 60, midichan: 1, mute: true },
    };
    const dispatches = collectExternalDispatches(event);
    expect(dispatches).toHaveLength(0);
  });

  it('returns no dispatches when no midi/osc properties are set', () => {
    const event = {
      begin: 0,
      channel: 'lead',
      duration: 1,
      end: 1,
      payload: { s: 'bd' },
    };
    const dispatches = collectExternalDispatches(event);
    expect(dispatches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Additional robustness tests
// ---------------------------------------------------------------------------
describe('queryScene validation', () => {
  it('rejects NaN begin', () => {
    const scene = makeScene(note('0'));
    expect(() => queryScene(scene, Number.NaN, 1, { cps: 1 })).toThrow();
  });

  it('rejects end < begin', () => {
    const scene = makeScene(note('0'));
    expect(() => queryScene(scene, 2, 1, { cps: 1 })).toThrow();
  });

  it('accepts zero-width window (begin === end) with no events', () => {
    const events = query(note('0 1'), 0.5, 0.5);
    expect(events).toHaveLength(0);
  });
});

describe('multi-cycle querying', () => {
  it('cat cycles through entries across cycles', () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: {
            args: [{ note: 'a' }, { note: 'b' }, { note: 'c' }],
            exprType: 'pattern',
            kind: 'call',
            name: 'cat',
          },
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const events = queryScene(scene, 0, 6, { cps: 1 });
    expect(events.map((e) => e.payload.note)).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });
});

describe('seq subdivision', () => {
  it('seq subdivides a cycle evenly', () => {
    const events = roundEvents(query(note(seq('c', 'e', 'g'))));
    expect(events).toHaveLength(3);
    expect(events[0]?.begin).toBe(0);
    expect(events[0]?.end).toBeCloseTo(1 / 3, 6);
    expect(events[1]?.begin).toBeCloseTo(1 / 3, 6);
    expect(events[2]?.begin).toBeCloseTo(2 / 3, 6);
    expect(events[2]?.end).toBe(1);
  });
});

describe('numeric value patterns', () => {
  it('value pattern carries values through', () => {
    const events = query(value('3 7 11'));
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.payload.value)).toEqual([3, 7, 11]);
  });

  it('add operation on value pattern', () => {
    const events = query(value('1 2 3').add(10));
    expect(events.map((e) => e.payload.value)).toEqual([11, 12, 13]);
  });

  it('sub operation on value pattern', () => {
    const events = query(value('10 20').sub(5));
    expect(events.map((e) => e.payload.value)).toEqual([5, 15]);
  });

  it('mul operation on value pattern', () => {
    const events = query(value('2 3').mul(4));
    expect(events.map((e) => e.payload.value)).toEqual([8, 12]);
  });

  it('div operation on value pattern', () => {
    const events = query(value('10 20').div(5));
    expect(events.map((e) => e.payload.value)).toEqual([2, 4]);
  });
});

describe('signal fast/slow on signals', () => {
  it('fast(2) doubles the signal frequency', () => {
    // saw at cycle 0.25 with fast(2) should equal saw at 0.5
    expect(evaluateNumericValue(saw.fast(2).expr, 0.25)).toBeCloseTo(0.5, 6);
  });

  it('slow(2) halves the signal frequency', () => {
    expect(evaluateNumericValue(saw.slow(2).expr, 0.5)).toBeCloseTo(0.25, 6);
  });
});

// ---------------------------------------------------------------------------
// 26. Channel error boundaries (audit items 5.9)
// ---------------------------------------------------------------------------
describe('channel error boundaries', () => {
  it('returns events from valid channels when another channel throws', () => {
    const validNode = note('c').expr;
    const brokenChannel = { node: null as unknown as ExpressionValue };
    Object.defineProperty(brokenChannel, 'node', {
      get() {
        throw new Error('deliberate test explosion');
      },
      enumerable: true,
      configurable: true,
    });
    const scene: SceneSpec = {
      channels: {
        good: { node: validNode },
        broken: brokenChannel,
      },
      samples: [],
      transport: { cps: 1 },
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const events = queryScene(scene, 0, 1, { cps: 1 });
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((e) => e.channel === 'good')).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[tussel/core] channel "broken" evaluation failed'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not crash queryScene when a channel evaluation throws', () => {
    const brokenChannel = { node: null as unknown as ExpressionValue };
    Object.defineProperty(brokenChannel, 'node', {
      get() {
        throw new TypeError('cannot read properties of kaboom');
      },
      enumerable: true,
      configurable: true,
    });
    const scene: SceneSpec = {
      channels: {
        failing: brokenChannel,
      },
      samples: [],
      transport: { cps: 1 },
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const events = queryScene(scene, 0, 1, { cps: 1 });
      expect(events).toEqual([]);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ===========================================================================
// COMPREHENSIVE ADDITIONAL TESTS
// ===========================================================================

// ---------------------------------------------------------------------------
// 27. stack composition (extended)
// ---------------------------------------------------------------------------
describe('stack composition (extended)', () => {
  it('overlays patterns so events from both layers appear at the same time', () => {
    const events = query(stack(s('bd'), s('sd')));
    expect(events).toHaveLength(2);
    expect(events[0]?.begin).toBe(0);
    expect(events[1]?.begin).toBe(0);
    const sounds = events.map((e) => e.payload.s);
    expect(sounds).toEqual(expect.arrayContaining(['bd', 'sd']));
  });

  it('overlays patterns with different densities preserving relative timing', () => {
    // bd has 1 event, "sd sd sd" has 3 events per cycle
    const events = query(stack(s('bd'), s('sd sd sd')));
    expect(events).toHaveLength(4);
    const bdEvents = events.filter((e) => e.payload.s === 'bd');
    const sdEvents = events.filter((e) => e.payload.s === 'sd');
    expect(bdEvents).toHaveLength(1);
    expect(sdEvents).toHaveLength(3);
    expect(bdEvents[0]?.begin).toBe(0);
    expect(bdEvents[0]?.end).toBe(1);
  });

  it('stack of stacks flattens layers', () => {
    const events = query(stack(stack(note('c'), note('e')), note('g')));
    expect(events).toHaveLength(3);
    const notes = events.map((e) => e.payload.note);
    expect(notes).toEqual(expect.arrayContaining(['c', 'e', 'g']));
  });

  it('stack with silence on one layer only produces other layer events', () => {
    const events = query(stack(silence(), silence(), note('c')));
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.note).toBe('c');
  });

  it('stack of a single pattern is equivalent to the pattern alone', () => {
    const plain = query(note('c d e'));
    const stacked = query(stack(note('c d e')));
    expect(stacked.map((e) => e.payload.note)).toEqual(plain.map((e) => e.payload.note));
    expect(stacked.map((e) => e.begin)).toEqual(plain.map((e) => e.begin));
  });
});

// ---------------------------------------------------------------------------
// 28. fast / slow transforms (extended)
// ---------------------------------------------------------------------------
describe('fast / slow transforms (extended)', () => {
  it('fast(3) triples event count', () => {
    const events = query(note('0').fast(3));
    expect(events).toHaveLength(3);
    for (const e of events) {
      expect(e.duration).toBeCloseTo(1 / 3, 6);
    }
  });

  it('fast(0.5) is equivalent to slow(2)', () => {
    const fastHalf = query(note('0 1').fast(0.5), 0, 2);
    const slowTwo = query(note('0 1').slow(2), 0, 2);
    expect(fastHalf.map((e) => e.payload.note)).toEqual(slowTwo.map((e) => e.payload.note));
  });

  it('slow(4) stretches pattern over 4 cycles', () => {
    const events = query(note('0 1 2 3').slow(4), 0, 4);
    expect(events).toHaveLength(4);
    for (const e of events) {
      expect(e.duration).toBeCloseTo(1, 6);
    }
  });

  it('fast then slow cancels out: fast(2).slow(2) is identity', () => {
    const plain = query(note('0 1'));
    const transformed = query(note('0 1').fast(2).slow(2));
    expect(transformed.map((e) => e.payload.note)).toEqual(plain.map((e) => e.payload.note));
    expect(transformed.map((e) => e.begin)).toEqual(plain.map((e) => e.begin));
  });

  it('slow then fast cancels out: slow(3).fast(3) is identity', () => {
    const plain = query(note('0 1'));
    const transformed = query(note('0 1').slow(3).fast(3));
    expect(transformed.map((e) => e.payload.note)).toEqual(plain.map((e) => e.payload.note));
  });
});

// ---------------------------------------------------------------------------
// 29. early / late shifts (extended)
// ---------------------------------------------------------------------------
describe('early / late shifts (extended)', () => {
  it('early(0.5) shifts events half a cycle earlier', () => {
    const events = query(note('0 1').early(0.5), 0, 1);
    // Originally: 0 at [0,0.5), 1 at [0.5,1)
    // After early(0.5): 0 at [-0.5,0), 1 at [0,0.5)
    // Plus wrapped: 0 at [0.5,1)
    const first = events.find((e) => e.begin === 0);
    expect(first).toBeDefined();
    expect(first?.payload.note).toBe(1);
  });

  it('late(0.5) shifts events half a cycle later', () => {
    const events = query(note('0 1').late(0.5), 0, 1);
    // Originally: 0 at [0,0.5), 1 at [0.5,1)
    // After late(0.5): 0 at [0.5,1), 1 at [1,1.5)
    // Plus wrapped: 1 at [0,0.5)
    const firstHalf = events.find((e) => e.begin === 0);
    expect(firstHalf).toBeDefined();
    expect(firstHalf?.payload.note).toBe(1);
  });

  it('early and late cancel: early(0.25).late(0.25) is identity', () => {
    const plain = query(note('0 1'));
    const shifted = query(note('0 1').early(0.25).late(0.25));
    expect(shifted.map((e) => e.payload.note)).toEqual(plain.map((e) => e.payload.note));
    expect(shifted.map((e) => e.begin)).toEqual(plain.map((e) => e.begin));
  });

  it('early(1) is a full cycle shift and equivalent to identity', () => {
    const plain = query(note('0 1'));
    const shifted = query(note('0 1').early(1));
    expect(shifted.map((e) => e.payload.note)).toEqual(plain.map((e) => e.payload.note));
  });

  it('late(1) is a full cycle shift and equivalent to identity', () => {
    const plain = query(note('0 1'));
    const shifted = query(note('0 1').late(1));
    expect(shifted.map((e) => e.payload.note)).toEqual(plain.map((e) => e.payload.note));
  });
});

// ---------------------------------------------------------------------------
// 30. ply repetition (extended)
// ---------------------------------------------------------------------------
describe('ply repetition (extended)', () => {
  it('ply(4) quadruples each event', () => {
    const events = query(note('0').ply(4));
    expect(events).toHaveLength(4);
    for (const e of events) {
      expect(e.payload.note).toBe(0);
      expect(e.duration).toBeCloseTo(0.25, 6);
    }
  });

  it('ply preserves per-event identity - each sub-event has same value', () => {
    const events = query(note('10 20').ply(3));
    expect(events).toHaveLength(6);
    const first3 = events.slice(0, 3);
    const last3 = events.slice(3, 6);
    for (const e of first3) {
      expect(e.payload.note).toBe(10);
    }
    for (const e of last3) {
      expect(e.payload.note).toBe(20);
    }
  });

  it('ply(2) on a fast(2) pattern produces 8 events', () => {
    const events = query(note('0 1').fast(2).ply(2));
    expect(events).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// 31. rev reversal (extended)
// ---------------------------------------------------------------------------
describe('rev reversal (extended)', () => {
  it('double rev is identity', () => {
    const plain = query(note('0 1 2 3'));
    const doubleRev = query(note('0 1 2 3').rev().rev());
    expect(doubleRev.map((e) => e.payload.note)).toEqual(plain.map((e) => e.payload.note));
  });

  it('rev preserves event durations', () => {
    const plain = query(note('0 1 2'));
    const reversed = query(note('0 1 2').rev());
    const plainDurations = plain.map((e) => e.duration).sort();
    const revDurations = reversed.map((e) => e.duration).sort();
    expect(revDurations).toHaveLength(plainDurations.length);
    for (let i = 0; i < revDurations.length; i++) {
      expect(revDurations[i]).toBeCloseTo(plainDurations[i]!, 6);
    }
  });

  it('rev of two events swaps their positions', () => {
    const events = query(note('a b').rev());
    expect(events[0]?.payload.note).toBe('b');
    expect(events[1]?.payload.note).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// 32. mask / struct filtering (extended)
// ---------------------------------------------------------------------------
describe('mask / struct filtering (extended)', () => {
  it('mask with alternating pattern creates syncopation', () => {
    const events = query(note('0 1 2 3 4 5 6 7').mask('1 0'));
    // mask "1 0" divides cycle in half; first half passes, second half blocked
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.begin).toBeLessThan(0.5);
    }
  });

  it('struct imposes the structure of the mask on the source pattern', () => {
    const events = query(s('bd sd hh oh').struct('1 0 1 0'));
    expect(events).toHaveLength(2);
  });

  it('mask with rest (~) removes those slots', () => {
    const events = query(note('0 1 2 3').mask('1 ~ 1 ~'));
    expect(events).toHaveLength(2);
  });

  it('mask with string "false" is falsy', () => {
    // "false" is treated as falsy in isTruthyMaskValue
    const events = query(note('0 1').mask('false false'));
    expect(events).toHaveLength(0);
  });

  it('mask with "0" string is falsy', () => {
    const events = query(note('0 1 2 3').mask('0 0 0 0'));
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 33. Signal evaluation (extended)
// ---------------------------------------------------------------------------
describe('signal evaluation (extended)', () => {
  it('sine is periodic with period 1', () => {
    const v0 = evaluateNumericValue(sine.expr, 0);
    const v1 = evaluateNumericValue(sine.expr, 1);
    expect(v0).toBeCloseTo(v1!, 6);
  });

  it('tri is periodic with period 1', () => {
    const v0 = evaluateNumericValue(tri.expr, 0.1);
    const v5 = evaluateNumericValue(tri.expr, 5.1);
    expect(v0).toBeCloseTo(v5!, 6);
  });

  it('square transitions at exactly 0.5', () => {
    expect(evaluateNumericValue(square.expr, 0.499)).toBe(0);
    expect(evaluateNumericValue(square.expr, 0.5)).toBe(1);
  });

  it('rand produces different values for different cycles', () => {
    const values = new Set<number>();
    for (let c = 0; c < 20; c++) {
      values.add(evaluateNumericValue(rand.expr, c)!);
    }
    // With 20 samples, rand should produce more than 1 unique value
    expect(values.size).toBeGreaterThan(1);
  });

  it('perlin is continuous: adjacent samples are close', () => {
    const step = 0.01;
    for (let c = 0; c < 5; c += step) {
      const a = evaluateNumericValue(perlin.expr, c)!;
      const b = evaluateNumericValue(perlin.expr, c + step)!;
      // Perlin noise should not have massive jumps between tiny steps
      expect(Math.abs(a - b)).toBeLessThan(0.5);
    }
  });

  it('saw ramps from 0 to 1 linearly', () => {
    expect(evaluateNumericValue(saw.expr, 0)).toBeCloseTo(0, 6);
    expect(evaluateNumericValue(saw.expr, 0.25)).toBeCloseTo(0.25, 6);
    expect(evaluateNumericValue(saw.expr, 0.5)).toBeCloseTo(0.5, 6);
    expect(evaluateNumericValue(saw.expr, 0.75)).toBeCloseTo(0.75, 6);
  });

  it('saw is periodic', () => {
    expect(evaluateNumericValue(saw.expr, 0.3)).toBeCloseTo(evaluateNumericValue(saw.expr, 1.3)!, 6);
  });

  it('all signals at negative cycle positions still return valid numbers', () => {
    for (const sig of [sine, tri, square, saw, rand, perlin]) {
      const v = evaluateNumericValue(sig.expr, -0.5);
      expect(v).toBeDefined();
      expect(typeof v).toBe('number');
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 34. Signal arithmetic operators (extended)
// ---------------------------------------------------------------------------
describe('signal arithmetic operators (extended)', () => {
  it('chained add: saw.add(1).add(2) offsets by 3', () => {
    expect(evaluateNumericValue(saw.add(1).add(2).expr, 0)).toBeCloseTo(3, 6);
    expect(evaluateNumericValue(saw.add(1).add(2).expr, 0.5)).toBeCloseTo(3.5, 6);
  });

  it('mul then add: saw.mul(10).add(5)', () => {
    // saw(0) = 0, 0*10+5 = 5
    expect(evaluateNumericValue(saw.mul(10).add(5).expr, 0)).toBeCloseTo(5, 6);
    // saw(0.5) = 0.5, 0.5*10+5 = 10
    expect(evaluateNumericValue(saw.mul(10).add(5).expr, 0.5)).toBeCloseTo(10, 6);
  });

  it('sub then mul: saw.sub(0.5).mul(2)', () => {
    // saw(0.5) = 0.5, (0.5-0.5)*2 = 0
    expect(evaluateNumericValue(saw.sub(0.5).mul(2).expr, 0.5)).toBeCloseTo(0, 6);
    // saw(0.75) = 0.75, (0.75-0.5)*2 = 0.5
    expect(evaluateNumericValue(saw.sub(0.5).mul(2).expr, 0.75)).toBeCloseTo(0.5, 6);
  });

  it('div by 1 is identity', () => {
    expect(evaluateNumericValue(saw.div(1).expr, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('mul by 1 is identity', () => {
    expect(evaluateNumericValue(saw.mul(1).expr, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('add 0 is identity', () => {
    expect(evaluateNumericValue(saw.add(0).expr, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('sub 0 is identity', () => {
    expect(evaluateNumericValue(saw.sub(0).expr, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('range with inverted min/max still works', () => {
    // range(20, 10) should map 0 -> 20, 1 -> 10
    expect(evaluateNumericValue(saw.range(20, 10).expr, 0)).toBeCloseTo(20, 6);
    expect(evaluateNumericValue(saw.range(20, 10).expr, 0.5)).toBeCloseTo(15, 6);
  });

  it('range with equal min/max returns constant', () => {
    expect(evaluateNumericValue(saw.range(5, 5).expr, 0)).toBeCloseTo(5, 6);
    expect(evaluateNumericValue(saw.range(5, 5).expr, 0.5)).toBeCloseTo(5, 6);
    expect(evaluateNumericValue(saw.range(5, 5).expr, 0.99)).toBeCloseTo(5, 6);
  });
});

// ---------------------------------------------------------------------------
// 35. Nested pattern composition (extended)
// ---------------------------------------------------------------------------
describe('nested pattern composition (extended)', () => {
  it('stack inside fast doubles all layers', () => {
    const events = query(stack(note('c'), note('e')).fast(2));
    // fast(2) doubles: 2 layers x 2 repetitions = 4 events
    expect(events).toHaveLength(4);
  });

  it('fast inside stack affects only that layer', () => {
    const events = query(stack(note('c').fast(2), note('e')));
    // note('c').fast(2) = 2 events, note('e') = 1 event
    expect(events).toHaveLength(3);
  });

  it('rev inside stack reverses only that layer', () => {
    const events = query(stack(note('0 1').rev(), note('2 3')));
    expect(events).toHaveLength(4);
    // The reversed layer has 1 then 0; the normal layer has 2 then 3
    const revLayer = events.filter((e) => [0, 1].includes(e.payload.note as number));
    expect(revLayer[0]?.payload.note).toBe(1);
    expect(revLayer[1]?.payload.note).toBe(0);
  });

  it('nested slow inside fast: slow(2) inside fast(2) = identity speed', () => {
    const plain = query(note('0 1'));
    const nested = query(note('0 1').slow(2).fast(2));
    expect(nested.map((e) => e.payload.note)).toEqual(plain.map((e) => e.payload.note));
  });

  it('ply inside stack affects only that layer', () => {
    const events = query(stack(note('0').ply(3), note('1')));
    expect(events).toHaveLength(4); // 3 from ply + 1 from other
    const zeros = events.filter((e) => e.payload.note === 0);
    const ones = events.filter((e) => e.payload.note === 1);
    expect(zeros).toHaveLength(3);
    expect(ones).toHaveLength(1);
  });

  it('mask on stacked pattern filters all layers', () => {
    const events = query(stack(note('0 1'), note('2 3')).mask('1 0'));
    // mask "1 0" keeps first half only -> 1 event from each layer
    for (const e of events) {
      expect(e.begin).toBeLessThan(0.5);
    }
  });
});

// ---------------------------------------------------------------------------
// 36. Negative cycle ranges (extended)
// ---------------------------------------------------------------------------
describe('negative cycle ranges (extended)', () => {
  it('events in negative range have correct begin/end', () => {
    const events = query(note('0 1'), -2, -1);
    expect(events).toHaveLength(2);
    expect(events[0]?.begin).toBe(-2);
    expect(events[0]?.end).toBeCloseTo(-1.5, 6);
    expect(events[1]?.begin).toBeCloseTo(-1.5, 6);
    expect(events[1]?.end).toBe(-1);
  });

  it('events spanning from negative to positive are consistent', () => {
    const events = query(note('0'), -2, 2);
    expect(events).toHaveLength(4); // 4 cycles: -2,-1, -1,0, 0,1, 1,2
  });

  it('signals evaluate correctly at negative cycles', () => {
    const v = evaluateNumericValue(sine.expr, -0.25);
    expect(v).toBeDefined();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 37. Empty patterns (extended)
// ---------------------------------------------------------------------------
describe('empty patterns (extended)', () => {
  it('silence with fast(2) still produces no events', () => {
    const events = query(silence().fast(2));
    expect(events).toHaveLength(0);
  });

  it('silence with slow(2) still produces no events', () => {
    const events = query(silence().slow(2), 0, 2);
    expect(events).toHaveLength(0);
  });

  it('silence with rev still produces no events', () => {
    const events = query(silence().rev());
    expect(events).toHaveLength(0);
  });

  it('stack of all silence produces no events', () => {
    const events = query(stack(silence(), silence(), silence()));
    expect(events).toHaveLength(0);
  });

  it('silence masked still produces no events', () => {
    const events = query(silence().mask('1 1 1'));
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 38. Patterns with rests (extended)
// ---------------------------------------------------------------------------
describe('patterns with rests (extended)', () => {
  it('rest in the middle of a sequence creates a gap', () => {
    const events = query(note('0 ~ 2 3'));
    expect(events).toHaveLength(3);
    const notes = events.map((e) => e.payload.note);
    expect(notes).toEqual([0, 2, 3]);
    // The first event starts at 0, the second should be at 0.5 (skipping 0.25)
    expect(events[0]?.begin).toBe(0);
    expect(events[1]?.begin).toBeCloseTo(0.5, 6);
  });

  it('alternating rests with values creates a sparse pattern', () => {
    const events = query(note('1 ~ 2 ~ 3 ~ 4 ~'));
    expect(events).toHaveLength(4);
    const notes = events.map((e) => e.payload.note);
    expect(notes).toEqual([1, 2, 3, 4]);
  });

  it('rest at the beginning of pattern skips first slot', () => {
    const events = query(note('~ 1 2'));
    expect(events).toHaveLength(2);
    expect(events[0]?.payload.note).toBe(1);
  });

  it('rest at the end of pattern skips last slot', () => {
    const events = query(note('0 1 ~'));
    expect(events).toHaveLength(2);
    expect(events[1]?.payload.note).toBe(1);
  });

  it('rest with fast still suppresses correctly', () => {
    const events = query(note('0 ~').fast(2));
    // 2 copies of "0 ~" = 2 events (2 rests suppressed)
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.payload.note).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 39. clip interaction with duration (extended)
// ---------------------------------------------------------------------------
describe('clip interaction with duration (extended)', () => {
  it('clip(1) does not change default duration', () => {
    const withClip = query(s('bd').clip(1));
    const without = query(s('bd'));
    expect(withClip[0]?.duration).toBeCloseTo(without[0]?.duration ?? 1, 6);
  });

  it('clip(0.25) scales duration to quarter', () => {
    const events = query(s('bd').clip(0.25));
    expect(events).toHaveLength(1);
    expect(events[0]?.duration).toBeCloseTo(0.25, 6);
    expect(events[0]?.payload.clip).toBe(0.25);
  });

  it('clip(2) sets the clip property and allows extended duration', () => {
    const events = query(s('bd').clip(2));
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.clip).toBe(2);
    // Duration may be capped by event span, but clip property is set
    expect(events[0]?.duration).toBeGreaterThan(0);
  });

  it('clip works with subdivided patterns', () => {
    const events = query(s('bd sd').clip(0.5));
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.duration).toBeCloseTo(0.25, 6);
      expect(e.payload.clip).toBe(0.5);
    }
  });

  it('clip inside fast correctly scales', () => {
    const events = query(s('bd').clip(0.5).fast(2));
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.duration).toBeCloseTo(0.25, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// 40. evaluateNumericValue edge cases (extended)
// ---------------------------------------------------------------------------
describe('evaluateNumericValue edge cases (extended)', () => {
  it('returns NaN for NaN number (passthrough)', () => {
    // evaluateNumericValue passes numbers through directly
    const result = evaluateNumericValue(Number.NaN, 0);
    expect(result).toBeNaN();
  });

  it('returns Infinity for Infinity (passthrough)', () => {
    expect(evaluateNumericValue(Number.POSITIVE_INFINITY, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns -Infinity for -Infinity (passthrough)', () => {
    expect(evaluateNumericValue(Number.NEGATIVE_INFINITY, 0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('returns undefined for empty string', () => {
    // Empty string produces no mini notation events
    expect(evaluateNumericValue('', 0)).toBeUndefined();
  });

  it('returns undefined for rest tilde "~"', () => {
    // A rest in mini notation should not produce a numeric value
    expect(evaluateNumericValue('~', 0)).toBeUndefined();
  });

  it('returns undefined for non-numeric string like "hello"', () => {
    expect(evaluateNumericValue('hello', 0)).toBeUndefined();
  });

  it('returns undefined for negative numeric string (not valid mini notation)', () => {
    // Mini notation does not parse "-5" as a numeric value
    expect(evaluateNumericValue('-5', 0)).toBeUndefined();
  });

  it('parses float numeric string', () => {
    expect(evaluateNumericValue('3.14', 0)).toBeCloseTo(3.14, 6);
  });

  it('returns 0 for "0"', () => {
    expect(evaluateNumericValue('0', 0)).toBe(0);
  });

  it('returns the number for zero', () => {
    expect(evaluateNumericValue(0, 0)).toBe(0);
  });

  it('returns the number for negative values', () => {
    expect(evaluateNumericValue(-42, 0)).toBe(-42);
  });

  it('handles nested arrays by evaluating first element', () => {
    expect(evaluateNumericValue([[99]], 0)).toBe(99);
  });

  it('returns undefined for empty array', () => {
    expect(evaluateNumericValue([], 0)).toBeUndefined();
  });

  it('returns undefined for object that is not an expression node', () => {
    expect(evaluateNumericValue({ foo: 'bar' } as unknown as ExpressionValue, 0)).toBeUndefined();
  });

  it('evaluates signal expression node (sine)', () => {
    const result = evaluateNumericValue(sine.expr, 0);
    expect(result).toBeCloseTo(0.5, 6);
  });

  it('evaluates pattern expression node', () => {
    const result = evaluateNumericValue(value('42').expr, 0);
    expect(result).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 41. isTruthyMaskValue edge cases (tested via mask behavior)
// ---------------------------------------------------------------------------
describe('isTruthyMaskValue edge cases (via mask)', () => {
  it('numeric 0 in mask is falsy', () => {
    const events = query(note('a b').mask('0 1'));
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.note).toBe('b');
  });

  it('numeric 1 in mask is truthy', () => {
    const events = query(note('a b').mask('1 1'));
    expect(events).toHaveLength(2);
  });

  it('negative number string in mask is not parsed as number by mini notation', () => {
    // Mini notation does not parse "-1" as a numeric value, so mask gets no events
    const events = query(note('a b').mask('-1 -1'));
    expect(events).toHaveLength(0);
  });

  it('string "0" in mask is falsy', () => {
    const events = query(note('a b c d').mask('0 0 0 0'));
    expect(events).toHaveLength(0);
  });

  it('rest "~" in mask is falsy (no event at that position)', () => {
    const events = query(note('a b').mask('1 ~'));
    // ~ in mini notation creates a rest, so no mask event -> no match
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.note).toBe('a');
  });

  it('positive numbers in mask are truthy', () => {
    const events = query(note('a b c d').mask('5 3 7 2'));
    expect(events).toHaveLength(4);
  });

  it('mixed truthy and falsy mask values filter correctly', () => {
    const events = query(note('a b c d').mask('1 0 1 0'));
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.payload.note)).toEqual(['a', 'c']);
  });
});

// ---------------------------------------------------------------------------
// 42. n() function and s() with n()
// ---------------------------------------------------------------------------
describe('n() function', () => {
  it('n produces events with n payload', () => {
    const events = query(n('0 1 2'));
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.payload.n)).toEqual([0, 1, 2]);
  });

  it('n with subdivisions produces correct event count', () => {
    const events = query(n('0 1 2 3'));
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.payload.n)).toEqual([0, 1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// 43. cat (slow concatenation) via DSL function
// ---------------------------------------------------------------------------
describe('cat (DSL function)', () => {
  it('cat plays one entry per cycle in sequence', () => {
    const events = query(cat(note('a'), note('b'), note('c')), 0, 3);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.payload.note)).toEqual(['a', 'b', 'c']);
  });

  it('cat wraps around after all entries played', () => {
    const events = query(cat(note('x'), note('y')), 0, 4);
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.payload.note)).toEqual(['x', 'y', 'x', 'y']);
  });

  it('single entry cat repeats every cycle', () => {
    const events = query(cat(note('z')), 0, 3);
    expect(events).toHaveLength(3);
    for (const e of events) {
      expect(e.payload.note).toBe('z');
    }
  });
});

// ---------------------------------------------------------------------------
// 44. Combination of transforms
// ---------------------------------------------------------------------------
describe('combined transforms', () => {
  it('fast + rev reverses within the compressed cycle', () => {
    const events = query(note('0 1 2 3').fast(2).rev());
    expect(events).toHaveLength(8);
    // Each half-cycle should be reversed
    const firstHalf = events.filter((e) => e.begin < 0.5).map((e) => e.payload.note);
    const secondHalf = events.filter((e) => e.begin >= 0.5).map((e) => e.payload.note);
    expect(firstHalf).toEqual([3, 2, 1, 0]);
    expect(secondHalf).toEqual([3, 2, 1, 0]);
  });

  it('mask + fast: fast doubles events, mask halves them', () => {
    const events = query(note('0 1').fast(2).mask('1 0'));
    // fast(2) -> 4 events, mask '1 0' keeps first half = 2 events
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThanOrEqual(4);
  });

  it('ply + rev: ply then reverse the repeated events', () => {
    const events = query(note('0 1').ply(2).rev());
    expect(events).toHaveLength(4);
    // After ply(2): [0,0,1,1], after rev: [1,1,0,0]
    expect(events.map((e) => e.payload.note)).toEqual([1, 1, 0, 0]);
  });

  it('stack + fast(2) doubles all layers', () => {
    const events = query(stack(note('c'), note('e')).fast(2));
    // 2 layers * 2 repetitions = 4
    expect(events).toHaveLength(4);
  });

  it('clip + slow stretches duration with slow factor', () => {
    const events = query(s('bd').clip(0.5).slow(2), 0, 2);
    expect(events).toHaveLength(1);
    // clip(0.5) of a slow(2) event: event duration = 2 * 0.5 = 1
    expect(events[0]?.duration).toBeCloseTo(1, 6);
  });
});

// ---------------------------------------------------------------------------
// 45. Multi-cycle consistency
// ---------------------------------------------------------------------------
describe('multi-cycle consistency', () => {
  it('querying cycle [0,1) and [1,2) separately equals querying [0,2)', () => {
    const scene = makeScene(note('0 1 2'));
    const all = queryScene(scene, 0, 2, { cps: 1 });
    const first = queryScene(scene, 0, 1, { cps: 1 });
    const second = queryScene(scene, 1, 2, { cps: 1 });
    expect(all).toHaveLength(first.length + second.length);
    expect(all.map((e) => e.payload.note)).toEqual(
      [...first, ...second].sort((a, b) => a.begin - b.begin).map((e) => e.payload.note),
    );
  });

  it('pattern repeats identically across cycles', () => {
    const scene = makeScene(note('0 1 2'));
    const cycle0 = queryScene(scene, 0, 1, { cps: 1 });
    const cycle5 = queryScene(scene, 5, 6, { cps: 1 });
    expect(cycle0.map((e) => e.payload.note)).toEqual(cycle5.map((e) => e.payload.note));
    // Durations should be approximately equal (floating point variance across cycles)
    const d0 = cycle0.map((e) => e.duration);
    const d5 = cycle5.map((e) => e.duration);
    expect(d0).toHaveLength(d5.length);
    for (let i = 0; i < d0.length; i++) {
      expect(d0[i]).toBeCloseTo(d5[i]!, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// 46. value pattern transforms with signals
// ---------------------------------------------------------------------------
describe('value pattern with signal transforms', () => {
  it('value pattern with mul by signal evaluates per event', () => {
    const events = query(value('1 1 1 1').mul(2));
    expect(events).toHaveLength(4);
    for (const e of events) {
      expect(e.payload.value).toBe(2);
    }
  });

  it('value div by constant', () => {
    const events = query(value('10 20 30').div(10));
    expect(events.map((e) => e.payload.value)).toEqual([1, 2, 3]);
  });

  it('value sub then add returns original', () => {
    const events = query(value('5 10 15').sub(3).add(3));
    expect(events.map((e) => e.payload.value)).toEqual([5, 10, 15]);
  });
});
