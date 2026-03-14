import { collectExternalDispatches, queryScene } from '@tussel/core';
import {
  add,
  defineScene,
  note,
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
import { describe, expect, it } from 'vitest';
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
    expect(evaluateNumericValue([42], 0)).toBe(42);
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
    const scene = makeScene(note('0 1').every(2, (p: any) => p.add(12)));
    const events = queryScene(scene, 0, 2, { cps: 1 });
    expect(events.map((e) => e.payload.note)).toEqual([12, 13, 0, 1]);
  });

  it('when applies transform when mask is truthy', () => {
    const scene = makeScene(note('0 1').when('0 1', (p: any) => p.add(7)));
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
