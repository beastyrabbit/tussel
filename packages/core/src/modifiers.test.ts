import { queryScene } from '@tussel/core';
import {
  add,
  areStringPrototypeExtensionsInstalled,
  choose,
  chord,
  defineScene,
  gamepad,
  grow,
  input,
  installStringPrototypeExtensions,
  midi,
  motion,
  note,
  type PatternBuilder,
  polymeter,
  rev,
  s,
  seq,
  sequence,
  shrink,
  stepcat,
  uninstallStringPrototypeExtensions,
  value,
  wchoose,
  zip,
} from '@tussel/dsl';
import {
  type ExpressionValue,
  resetInputRegistry,
  setGamepadValue,
  setInputValue,
  setMidiValue,
  setMotionValue,
} from '@tussel/ir';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  resetInputRegistry();
  while (areStringPrototypeExtensionsInstalled()) {
    uninstallStringPrototypeExtensions();
  }
});

describe('core modifiers and factories', () => {
  it('rejects invalid query windows', () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: note('0 1'),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(() => queryScene(scene, Number.NaN, 1, { cps: 1 })).toThrow(
      'queryScene() requires finite begin/end values.',
    );
    expect(() => queryScene(scene, 2, 1, { cps: 1 })).toThrow(
      'queryScene() requires end >= begin, received begin=2 end=1.',
    );
  });

  it('applies every() to the selected cycles only', () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: note('0 1').every(2, (pattern: PatternBuilder) => pattern.add(12)),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(scene, 0, 2, { cps: 1 }).map((event) => event.payload.note)).toEqual([12, 13, 0, 1]);
  });

  it('applies when() using truthy mask values', () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: note('0 1').when('0 1', (pattern: PatternBuilder) => pattern.add(7)),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(scene, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([0, 8]);
  });

  it('supports numeric payload arithmetic, rounding, and offsets', () => {
    const rounded = defineScene({
      channels: {
        lead: {
          node: value('1.2 2.8').floor().ply(1),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const transposed = defineScene({
      channels: {
        lead: {
          node: note('0 2').offset(12),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(rounded, 0, 1, { cps: 1 }).map((event) => event.payload.value)).toEqual([1, 2]);
    expect(queryScene(transposed, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([12, 14]);
  });

  it('reads external input/device signals from the shared registry', () => {
    setInputValue('knob:one', 0.25);
    setMidiValue(74, 0.5);
    setGamepadValue('axis:0', 0.75, 1);
    setMotionValue('x', 1);

    const scene = defineScene({
      channels: {
        knob: { node: note(input('knob:one').range(0, 12)) },
        mod: { node: note(midi(74).range(0, 12)) },
        stick: { node: note(gamepad('axis:0', 1).range(0, 12)) },
        tilt: { node: note(motion('x').range(0, 12)) },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(scene, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([3, 6, 9, 12]);
  });

  it('degrades events deterministically', () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: s('bd bd bd bd').degradeBy(1),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(scene, 0, 1, { cps: 1 })).toEqual([]);
    expect(queryScene(scene, 0, 1, { cps: 1 })).toEqual([]);
  });

  it('supports choose(), wchoose(), and sequence()', () => {
    const weighted = defineScene({
      channels: {
        lead: {
          node: wchoose([1, 100], [2, 0]),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(weighted, 0, 3, { cps: 1 }).map((event) => event.payload.value)).toEqual([1, 1, 1]);

    const chosen = defineScene({
      channels: {
        lead: {
          node: choose(1, 2),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const first = queryScene(chosen, 0, 4, { cps: 1 }).map((event) => event.payload.value);
    const second = queryScene(chosen, 0, 4, { cps: 1 }).map((event) => event.payload.value);
    expect(first).toEqual(second);
    expect(first.every((value) => value === 1 || value === 2)).toBe(true);

    const sequenceScene = defineScene({
      channels: {
        lead: {
          node: sequence(1, 2, 3),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const seqScene = defineScene({
      channels: {
        lead: {
          node: seq(1, 2, 3),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    expect(queryScene(sequenceScene, 0, 1, { cps: 1 })).toEqual(queryScene(seqScene, 0, 1, { cps: 1 }));
  });

  it('executes transform helpers the same as callback forms', () => {
    const helperScene = defineScene({
      channels: {
        lead: {
          node: note('0 1').every(2, add(12)),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const callbackScene = defineScene({
      channels: {
        lead: {
          node: note('0 1').every(2, (pattern: PatternBuilder) => pattern.add(12)),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(helperScene, 0, 2, { cps: 1 })).toEqual(queryScene(callbackScene, 0, 2, { cps: 1 }));
  });

  it('applies within() to the selected cycle window', () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: note('0 1').within(0, 0.5, add(12)),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(scene, 0, 1, { cps: 1 }).map((event) => [event.begin, event.payload.note])).toEqual([
      [0, 12],
      [0.5, 1],
    ]);
  });

  it('supports zoom(), compress(), and fastGap() window remapping', () => {
    const zoomScene = defineScene({
      channels: { lead: { node: note('0 1 2 3').zoom(0.25, 0.75) } },
      samples: [],
      transport: { cps: 1 },
    });
    const compressScene = defineScene({
      channels: { lead: { node: note('0 1 2 3').compress(0.25, 0.75) } },
      samples: [],
      transport: { cps: 1 },
    });
    const gapScene = defineScene({
      channels: { lead: { node: note('0 1 2 3').fastGap(2) } },
      samples: [],
      transport: { cps: 1 },
    });

    expect(
      queryScene(zoomScene, 0, 1, { cps: 1 }).map((event) => [event.begin, event.end, event.payload.note]),
    ).toEqual([
      [0, 0.5, 1],
      [0.5, 1, 2],
    ]);
    expect(
      queryScene(compressScene, 0, 1, { cps: 1 }).map((event) => [
        event.begin,
        event.end,
        event.payload.note,
      ]),
    ).toEqual([
      [0.25, 0.375, 0],
      [0.375, 0.5, 1],
      [0.5, 0.625, 2],
      [0.625, 0.75, 3],
    ]);
    expect(
      queryScene(gapScene, 0, 1, { cps: 1 }).map((event) => [event.begin, event.end, event.payload.note]),
    ).toEqual([
      [0, 0.125, 0],
      [0.125, 0.25, 1],
      [0.25, 0.375, 2],
      [0.375, 0.5, 3],
    ]);
  });

  it('supports hurry() and linger()', () => {
    const hurryScene = defineScene({
      channels: { lead: { node: s('bd sd').hurry(2) } },
      samples: [],
      transport: { cps: 1 },
    });
    const lingerScene = defineScene({
      channels: { lead: { node: note('0 1 2 3 4 5 6 7').linger(0.25) } },
      samples: [],
      transport: { cps: 1 },
    });

    expect(
      queryScene(hurryScene, 0, 1, { cps: 1 }).map((event) => [
        event.begin,
        event.payload.s,
        event.payload.speed,
      ]),
    ).toEqual([
      [0, 'bd', 2],
      [0.25, 'sd', 2],
      [0.5, 'bd', 2],
      [0.75, 'sd', 2],
    ]);
    expect(queryScene(lingerScene, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([
      0, 1, 0, 1, 0, 1, 0, 1,
    ]);
  });

  it('supports deterministic shuffle() and scramble()', () => {
    const shuffleScene = defineScene({
      channels: { lead: { node: note('0 1 2 3').shuffle(4) } },
      samples: [],
      transport: { cps: 1 },
    });
    const scrambleScene = defineScene({
      channels: { lead: { node: note('0 1 2 3').scramble(4) } },
      samples: [],
      transport: { cps: 1 },
    });

    const shuffledA = queryScene(shuffleScene, 0, 1, { cps: 1 }).map((event) => event.payload.note);
    const shuffledB = queryScene(shuffleScene, 0, 1, { cps: 1 }).map((event) => event.payload.note);
    const scrambledA = queryScene(scrambleScene, 0, 1, { cps: 1 }).map((event) => event.payload.note);
    const scrambledB = queryScene(scrambleScene, 0, 1, { cps: 1 }).map((event) => event.payload.note);

    expect(shuffledA).toEqual(shuffledB);
    expect(scrambledA).toEqual(scrambledB);
    expect([...shuffledA].sort()).toEqual([0, 1, 2, 3]);
    expect(scrambledA).toHaveLength(4);
  });

  it('executes each helper transform individually and verifies correctness', () => {
    const base = note('0 1 2 3');
    const q = (node: unknown) =>
      queryScene(
        defineScene({
          channels: { lead: { node: node as ExpressionValue } },
          samples: [],
          transport: { cps: 1 },
        }),
        0,
        1,
        { cps: 1 },
      );

    // zoom: should select inner window of the pattern
    const zoomed = q(base.zoom(0.25, 0.75));
    expect(zoomed.length).toBe(2);
    expect(zoomed.map((e) => e.payload.note)).toEqual([1, 2]);

    // compress: should compress all events into a sub-range
    const compressed = q(base.compress(0.25, 0.75));
    expect(compressed.length).toBe(4);
    expect(compressed.every((e) => e.begin >= 0.25 && e.end <= 0.75)).toBe(true);

    // fastGap: should fit events into first half, leave second half empty
    const gapped = q(base.fastGap(2));
    expect(gapped.length).toBe(4);
    expect(gapped.every((e) => e.end <= 0.5 + 1e-9)).toBe(true);

    // hurry: should double speed and set speed property
    const hurried = q(s('bd sd').hurry(2));
    expect(hurried.length).toBe(4);
    expect(hurried.every((e) => e.payload.speed === 2)).toBe(true);

    // linger: should repeat first fraction of the pattern
    const lingered = q(note('0 1 2 3 4 5 6 7').linger(0.25));
    expect(lingered.length).toBe(8);
    expect(lingered.map((e) => e.payload.note)).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);

    // shuffle: should produce a permutation of the original values
    const shuffled = q(base.shuffle(4));
    expect(shuffled.length).toBe(4);
    expect([...shuffled.map((e) => e.payload.note)].sort()).toEqual([0, 1, 2, 3]);

    // scramble: should produce 4 events (possibly with repeats)
    const scrambled = q(base.scramble(4));
    expect(scrambled.length).toBe(4);
  });

  it('treats slowGap() as the inverse of fastGap()', () => {
    const equivalentFastScene = defineScene({
      channels: { lead: { node: note('0 1 2 3').fastGap(0.5) } },
      samples: [],
      transport: { cps: 1 },
    });
    const slowScene = defineScene({
      channels: { lead: { node: note('0 1 2 3').slowGap(2) } },
      samples: [],
      transport: { cps: 1 },
    });
    const fastScene = defineScene({
      channels: { lead: { node: note('0 1 2 3').fastGap(2) } },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(slowScene, 0, 1, { cps: 1 })).toEqual(
      queryScene(equivalentFastScene, 0, 1, { cps: 1 }),
    );
    expect(queryScene(slowScene, 0, 1, { cps: 1 })).not.toEqual(queryScene(fastScene, 0, 1, { cps: 1 }));
  });

  it('supports tonal scale and transposition helpers', () => {
    const scaled = defineScene({
      channels: {
        lead: {
          node: value('0 2 4').scale('C:major').note(),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const transposed = defineScene({
      channels: {
        lead: {
          node: note('C4 E4').transpose(12),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const scaleShifted = defineScene({
      channels: {
        lead: {
          node: value('0 1 2').scale('C:major').scaleTranspose(2).note(),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(scaled, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([
      'C3',
      'E3',
      'G3',
    ]);
    expect(queryScene(transposed, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual(['C5', 'E5']);
    expect(queryScene(scaleShifted, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([
      'E3',
      'F3',
      'G3',
    ]);
  });

  it('aligns scale degrees and voicings to anchor values', () => {
    const anchoredScale = defineScene({
      channels: {
        lead: {
          node: value('0 1 2').anchor('G4').scale('C:major').note(),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const anchoredVoicing = defineScene({
      channels: {
        lead: {
          node: chord('C^7').dict('guidetones').anchor(66).voicing(),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(anchoredScale, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([
      67, 69, 71,
    ]);
    expect(queryScene(anchoredVoicing, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([
      'B3',
      'E4',
    ]);
  });

  it('handles sometimesBy probability extremes deterministically', () => {
    const neverScene = defineScene({
      channels: {
        lead: {
          node: note('0 1 2 3').sometimesBy(0, rev),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const alwaysScene = defineScene({
      channels: {
        lead: {
          node: note('0 1 2 3').sometimesBy(1, rev),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(neverScene, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([0, 1, 2, 3]);
    expect(queryScene(alwaysScene, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([
      3, 2, 1, 0,
    ]);
  });

  it('supports fractional degradeBy values', () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: s('bd bd bd bd').degradeBy(0.5),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const eventsA = queryScene(scene, 0, 1, { cps: 1 }).map((event) => event.begin);
    const eventsB = queryScene(scene, 0, 1, { cps: 1 }).map((event) => event.begin);
    expect(eventsA).toEqual(eventsB);
    expect(eventsA.length).toBeGreaterThan(0);
    expect(eventsA.length).toBeLessThan(4);
  });

  it('duplicates events with ply and reverses them with rev', () => {
    const plyScene = defineScene({
      channels: {
        lead: {
          node: note('0 1').ply(2),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const revScene = defineScene({
      channels: {
        lead: {
          node: note('0 1 2 3').rev(),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(plyScene, 0, 1, { cps: 1 }).map((event) => [event.begin, event.payload.note])).toEqual([
      [0, 0],
      [0.25, 0],
      [0.5, 1],
      [0.75, 1],
    ]);
    expect(queryScene(revScene, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([3, 2, 1, 0]);
  });

  it('supports chord root notes and voicing expansion', () => {
    const rooted = defineScene({
      channels: {
        lead: {
          node: chord('C^7 A7b13').rootNotes(2),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const voiced = defineScene({
      channels: {
        lead: {
          node: chord('C^7').dict('guidetones').voicing().s('sine'),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const selectedVoice = defineScene({
      channels: {
        lead: {
          node: chord('C^7').dict('ireal').set({ n: 1 }).mode('root:g2').voicing().s('saw'),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(rooted, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual(['C2', 'A2']);
    expect(queryScene(voiced, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual(['E4', 'B4']);
    expect(queryScene(selectedVoice, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual(['C2']);
    expect(queryScene(selectedVoice, 0, 1, { cps: 1 }).map((event) => event.payload.s)).toEqual(['saw']);
  });

  it('supports stepcat() with inferred and explicit step counts', () => {
    const inferred = defineScene({
      channels: {
        lead: {
          node: stepcat('bd hh hh', 'bd hh hh cp hh').sound(),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const explicit = defineScene({
      channels: {
        lead: {
          node: stepcat([3, 'e3'], [1, 'g3']).note(),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(
      queryScene(inferred, 0, 1, { cps: 1 }).map((event) => [
        event.begin,
        event.end,
        event.payload.sound ?? event.payload.s,
      ]),
    ).toEqual([
      [0, 0.125, 'bd'],
      [0.125, 0.25, 'hh'],
      [0.25, 0.375, 'hh'],
      [0.375, 0.5, 'bd'],
      [0.5, 0.625, 'hh'],
      [0.625, 0.75, 'hh'],
      [0.75, 0.875, 'cp'],
      [0.875, 1, 'hh'],
    ]);
    expect(
      queryScene(explicit, 0, 1, { cps: 1 }).map((event) => [event.begin, event.end, event.payload.note]),
    ).toEqual([
      [0, 0.75, 'e3'],
      [0.75, 1, 'g3'],
    ]);
  });

  it('supports pace(), expand(), and contract() for stepwise timing', () => {
    installStringPrototypeExtensions();
    const expanded = defineScene({
      channels: {
        lead: {
          node: stepcat('c a f e'.expand(2), 'g d').note(),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const paced = defineScene({
      channels: {
        lead: {
          node: stepcat('c a f e'.expand(2), 'g d').note().pace(8),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const contracted = defineScene({
      channels: {
        lead: {
          node: note('0 1 2 3').contract(2).pace(4),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const expandedEvents = queryScene(expanded, 0, 1, { cps: 1 });
    expect(expandedEvents).toHaveLength(6);
    expect(expandedEvents.map((e) => e.payload.note)).toEqual(['c', 'a', 'f', 'e', 'g', 'd']);
    expect(expandedEvents[0]?.begin).toBeCloseTo(0, 9);
    expect(expandedEvents[0]?.end).toBeCloseTo(0.2, 9);
    expect(expandedEvents[2]?.begin).toBeCloseTo(0.4, 9);
    expect(expandedEvents[2]?.end).toBeCloseTo(0.6, 9);
    expect(expandedEvents[3]?.begin).toBeCloseTo(0.6, 9);
    expect(expandedEvents[3]?.end).toBeCloseTo(0.8, 9);
    expect(expandedEvents[4]?.begin).toBeCloseTo(0.8, 9);
    expect(expandedEvents[5]?.end).toBeCloseTo(1, 9);
    const pacedEvents = queryScene(paced, 0, 1, { cps: 1 });
    expect(pacedEvents).toHaveLength(4);
    expect(pacedEvents.map((e) => e.payload.note)).toEqual(['c', 'a', 'f', 'e']);
    expect(pacedEvents[0]?.begin).toBeCloseTo(0, 9);
    expect(pacedEvents[0]?.end).toBeCloseTo(0.25, 9);
    expect(pacedEvents[2]?.begin).toBeCloseTo(0.5, 9);
    expect(pacedEvents[2]?.end).toBeCloseTo(0.75, 9);
    expect(pacedEvents[3]?.begin).toBeCloseTo(0.75, 9);
    expect(pacedEvents[3]?.end).toBeCloseTo(1, 9);
    expect(queryScene(contracted, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([
      0, 1, 2, 3, 0, 1, 2, 3,
    ]);
  });

  it('supports patterned expand() and stepwise polymeter()', () => {
    installStringPrototypeExtensions();
    const expanded = defineScene({
      channels: {
        lead: {
          node: note('c a f e').expand('3 2 1').pace(8),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const meter = defineScene({
      channels: {
        lead: {
          node: polymeter('a b c', 'd e'),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(
      queryScene(expanded, 0, 1, { cps: 1 }).map((event) => [event.begin, event.end, event.payload.note]),
    ).toEqual([
      [0, 0.375, 'c'],
      [0.375, 0.75, 'a'],
      [0.75, 1, 'f'],
    ]);
    const meterEvents = queryScene(meter, 0, 1, { cps: 1 });
    expect(meterEvents).toHaveLength(12);
    expect(meterEvents.map((e) => e.payload.value)).toEqual([
      'a',
      'd',
      'b',
      'e',
      'c',
      'd',
      'a',
      'e',
      'b',
      'd',
      'c',
      'e',
    ]);
    // Verify timing uses toBeCloseTo to avoid IEEE 754 representation issues
    expect(meterEvents[0]?.begin).toBeCloseTo(0, 9);
    expect(meterEvents[2]?.begin).toBeCloseTo(1 / 6, 9);
    expect(meterEvents[4]?.begin).toBeCloseTo(1 / 3, 9);
    expect(meterEvents[6]?.begin).toBeCloseTo(1 / 2, 9);
    expect(meterEvents[8]?.begin).toBeCloseTo(2 / 3, 9);
    expect(meterEvents[10]?.begin).toBeCloseTo(5 / 6, 9);
  });

  it('supports shrink(), grow(), tour(), and zip()', () => {
    const shrunk = defineScene({
      channels: {
        lead: {
          node: note('0 1 2 3').shrink(1),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const grown = defineScene({
      channels: {
        lead: {
          node: note('0 1 2 3').grow(1),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const toured = defineScene({
      channels: {
        lead: {
          node: value('c g').tour('e f', 'g a').note(),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const zipped = defineScene({
      channels: {
        lead: {
          node: zip('a b', 'c d e'),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(shrunk, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([
      0, 1, 2, 3, 2, 3, 3, 3,
    ]);
    expect(queryScene(grown, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([
      0, 0, 0, 1, 0, 1, 2, 3,
    ]);
    expect(queryScene(toured, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([
      'e',
      'f',
      'g',
      'a',
      'c',
      'g',
      'e',
      'f',
      'c',
      'g',
      'g',
      'a',
      'c',
      'g',
      'e',
      'f',
      'g',
      'a',
    ]);
    expect(queryScene(zipped, 0, 1, { cps: 1 }).map((event) => event.payload.value)).toEqual([
      'a',
      'c',
      'b',
      'd',
      'a',
      'e',
      'b',
      'c',
      'a',
      'd',
      'b',
      'e',
    ]);
  });

  it('executes shrink() and grow() helper transforms', () => {
    const helperScene = defineScene({
      channels: {
        lead: {
          node: note('0 1 2 3').every(2, shrink(1)).every(3, grow(1)),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(helperScene, 0, 3, { cps: 1 }).length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // New time-modifier functions (A.01-A.13)
  // -----------------------------------------------------------------------

  it('palindrome reverses every other cycle', () => {
    const scene = defineScene({
      channels: { lead: { node: note('0 1 2 3').palindrome() } },
      samples: [],
      transport: { cps: 1 },
    });

    const cycle0 = queryScene(scene, 0, 1, { cps: 1 }).map((e) => e.payload.note);
    const cycle1 = queryScene(scene, 1, 2, { cps: 1 }).map((e) => e.payload.note);
    // Cycle 0: forward [0, 1, 2, 3]
    expect(cycle0).toEqual([0, 1, 2, 3]);
    // Cycle 1: reversed [3, 2, 1, 0]
    expect(cycle1).toEqual([3, 2, 1, 0]);
  });

  it('iter(n) rotates pattern start each cycle', () => {
    const scene = defineScene({
      channels: { lead: { node: note('0 1 2 3').iter(4) } },
      samples: [],
      transport: { cps: 1 },
    });

    const c0 = queryScene(scene, 0, 1, { cps: 1 }).map((e) => e.payload.note);
    const c1 = queryScene(scene, 1, 2, { cps: 1 }).map((e) => e.payload.note);
    const c2 = queryScene(scene, 2, 3, { cps: 1 }).map((e) => e.payload.note);

    // Cycle 0: [0,1,2,3], Cycle 1: [1,2,3,0], Cycle 2: [2,3,0,1]
    expect(c0).toEqual([0, 1, 2, 3]);
    expect(c1).toEqual([1, 2, 3, 0]);
    expect(c2).toEqual([2, 3, 0, 1]);
  });

  it('iterBack(n) rotates pattern in reverse', () => {
    const scene = defineScene({
      channels: { lead: { node: note('0 1 2 3').iterBack(4) } },
      samples: [],
      transport: { cps: 1 },
    });

    const c0 = queryScene(scene, 0, 1, { cps: 1 }).map((e) => e.payload.note);
    const c1 = queryScene(scene, 1, 2, { cps: 1 }).map((e) => e.payload.note);

    expect(c0).toEqual([0, 1, 2, 3]);
    expect(c1).toEqual([3, 0, 1, 2]);
  });

  it('inside(n, transform) slows then transforms then speeds up', () => {
    const scene = defineScene({
      channels: {
        lead: { node: note('0 1 2 3').inside(2, (p: PatternBuilder) => p.rev()) },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.length).toBeGreaterThan(0);
  });

  it('outside(n, transform) speeds then transforms then slows', () => {
    const scene = defineScene({
      channels: {
        lead: { node: note('0 1 2 3').outside(2, (p: PatternBuilder) => p.rev()) },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 2, { cps: 1 });
    expect(events.length).toBeGreaterThan(0);
  });

  it('ribbon(offset, cycles) loops a section of the pattern', () => {
    const scene = defineScene({
      channels: { lead: { node: note('0 1 2 3').ribbon(0, 2) } },
      samples: [],
      transport: { cps: 1 },
    });

    const c0 = queryScene(scene, 0, 1, { cps: 1 });
    const c2 = queryScene(scene, 2, 3, { cps: 1 });
    // Should loop every 2 cycles, so c0 and c2 should be the same
    expect(c0.map((e) => e.payload.note)).toEqual(c2.map((e) => e.payload.note));
  });

  it('swingBy delays events in the second half of subdivisions', () => {
    const scene = defineScene({
      channels: { lead: { node: note('0 1 2 3').swingBy(0.5, 2) } },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.length).toBe(4);
    // Events at positions 0.25 and 0.75 should be delayed
    const secondEvent = events[1];
    const fourthEvent = events[3];
    expect(secondEvent).toBeDefined();
    expect(fourthEvent).toBeDefined();
    // These should be shifted later than their original 0.25 and 0.75
    expect(secondEvent!.begin).toBeGreaterThan(0.25);
    expect(fourthEvent!.begin).toBeGreaterThan(0.75);
  });

  it('swing is shorthand for swingBy(1/3, n)', () => {
    const scene = defineScene({
      channels: { lead: { node: note('0 1 2 3').swing(2) } },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.length).toBe(4);
  });

  it('cpm(120) doubles the speed (120 cycles per minute = 2 cps)', () => {
    const scene = defineScene({
      channels: { lead: { node: note('0 1').cpm(120) } },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    // cpm(120) = fast(120/60) = fast(2), so 4 events in one cycle
    expect(events.length).toBe(4);
  });

  it('sparsity is an alias for slow', () => {
    const withSlow = defineScene({
      channels: { lead: { node: note('0 1 2 3').slow(2) } },
      samples: [],
      transport: { cps: 1 },
    });
    const withSparsity = defineScene({
      channels: { lead: { node: note('0 1 2 3').sparsity(2) } },
      samples: [],
      transport: { cps: 1 },
    });

    const slowEvents = queryScene(withSlow, 0, 2, { cps: 1 }).map((e) => e.payload.note);
    const sparsityEvents = queryScene(withSparsity, 0, 2, { cps: 1 }).map((e) => e.payload.note);
    expect(sparsityEvents).toEqual(slowEvents);
  });

  it('density is an alias for fast', () => {
    const withFast = defineScene({
      channels: { lead: { node: note('0 1').fast(2) } },
      samples: [],
      transport: { cps: 1 },
    });
    const withDensity = defineScene({
      channels: { lead: { node: note('0 1').density(2) } },
      samples: [],
      transport: { cps: 1 },
    });

    const fastEvents = queryScene(withFast, 0, 1, { cps: 1 }).map((e) => e.payload.note);
    const densityEvents = queryScene(withDensity, 0, 1, { cps: 1 }).map((e) => e.payload.note);
    expect(densityEvents).toEqual(fastEvents);
  });

  it('euclidRot distributes pulses with rotation', () => {
    const scene = defineScene({
      channels: { lead: { node: note('0').euclidRot(3, 8, 0) } },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    // 3 pulses in 8 steps
    expect(events.length).toBe(3);
  });

  it('euclidLegato holds each onset until the next', () => {
    const scene = defineScene({
      channels: { lead: { node: note('0').euclidLegato(3, 8) } },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.length).toBe(3);
    // Each event should extend to the next onset (no gaps)
    for (let i = 0; i < events.length - 1; i++) {
      const gap = events[i + 1]!.begin - events[i]!.end;
      expect(Math.abs(gap)).toBeLessThan(0.01);
    }
  });

  it('fmap adds a value to each event payload number', () => {
    const scene = defineScene({
      channels: { lead: { node: note('0 1 2').fmap(10) } },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.map((e) => e.payload.note)).toEqual([10, 11, 12]);
  });

  // -----------------------------------------------------------------------
  // Alignment modes (A.14-A.20)
  // -----------------------------------------------------------------------

  it('addIn aligns to left pattern structure', () => {
    const scene = defineScene({
      channels: { lead: { node: note('0 1 2').addIn(note('10 20')) } },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    // Left has 3 events, right has 2 — left controls structure
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it('addOut aligns to right pattern structure', () => {
    const scene = defineScene({
      channels: { lead: { node: note('0 1 2').addOut(note('10 20')) } },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it('addMix combines intersecting events', () => {
    const scene = defineScene({
      channels: { lead: { node: note('0 1').addMix(note('10 20')) } },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.length).toBeGreaterThan(0);
  });

  it('addSqueeze squeezes right into left event spans', () => {
    const scene = defineScene({
      channels: { lead: { node: note('0 1').addSqueeze(note('10 20')) } },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    // Each of 2 left events gets 2 right events squeezed in = 4 events
    expect(events.length).toBeGreaterThanOrEqual(4);
  });

  // -----------------------------------------------------------------------
  // Edge case tests (J.01-J.12)
  // -----------------------------------------------------------------------

  it('empty pattern produces no events', () => {
    const scene = defineScene({
      channels: { lead: { node: note('~') } },
      samples: [],
      transport: { cps: 1 },
    });
    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events).toEqual([]);
  });

  it('gain(0) produces events with gain zero', () => {
    const scene = defineScene({
      channels: { lead: { node: s('bd').gain(0) } },
      samples: [],
      transport: { cps: 1 },
    });
    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.length).toBe(1);
    expect(events[0]!.payload.gain).toBe(0);
  });

  it('speed(0) produces events with speed zero', () => {
    const scene = defineScene({
      channels: { lead: { node: s('bd').speed(0) } },
      samples: [],
      transport: { cps: 1 },
    });
    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.length).toBe(1);
    expect(events[0]!.payload.speed).toBe(0);
  });

  it('querying very large cycle numbers does not crash', () => {
    const scene = defineScene({
      channels: { lead: { node: note('0 1 2 3') } },
      samples: [],
      transport: { cps: 1 },
    });
    const events = queryScene(scene, 1_000_000, 1_000_001, { cps: 1 });
    expect(events.length).toBe(4);
  });

  it('deeply nested patterns do not stack overflow', () => {
    let pattern = note('0');
    for (let i = 0; i < 20; i++) {
      pattern = pattern.add(1);
    }
    const scene = defineScene({
      channels: { lead: { node: pattern } },
      samples: [],
      transport: { cps: 1 },
    });
    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.length).toBe(1);
    expect(events[0]!.payload.note).toBe(20);
  });
});
