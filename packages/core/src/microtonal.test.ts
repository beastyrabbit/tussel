import { queryScene, tunedStepFrequency } from '@tussel/core';
import { defineScene, getFreq, i, midikeys, midin, note, value } from '@tussel/dsl';
import {
  namedPitchToFrequency,
  resetInputRegistry,
  resetMidiNoteState,
  setMidiNoteOff,
  setMidiNoteOn,
} from '@tussel/ir';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  resetInputRegistry();
  resetMidiNoteState();
});

describe('microtonal helpers', () => {
  it('namedPitchToFrequency resolves standard pitches', () => {
    expect(namedPitchToFrequency('a4')).toBeCloseTo(440, 2);
    expect(namedPitchToFrequency('c3')).toBeCloseTo(130.81, 1);
    expect(namedPitchToFrequency('c#4')).toBeCloseTo(277.18, 1);
    expect(namedPitchToFrequency('eb3')).toBeCloseTo(155.56, 1);
    expect(namedPitchToFrequency('not-a-note')).toBeUndefined();
  });

  it('tunedStepFrequency supports Nedo strings', () => {
    const c4 = tunedStepFrequency('12edo', 0);
    expect(c4).toBeCloseTo(261.63, 1);
    // Step = divisions of the octave doubles the base frequency.
    expect(tunedStepFrequency('12edo', 12)).toBeCloseTo(261.63 * 2, 1);
    expect(tunedStepFrequency('31edo', 31)).toBeCloseTo(261.63 * 2, 1);
    expect(tunedStepFrequency('31edo', 8)).not.toBeCloseTo(tunedStepFrequency('12edo', 8) ?? 0, 1);
  });

  it('tunedStepFrequency wraps ratio tables across octaves', () => {
    const spec = [1, 9 / 8, 5 / 4];
    expect(tunedStepFrequency(spec, 0)).toBeCloseTo(261.63, 1);
    expect(tunedStepFrequency(spec, 1)).toBeCloseTo(261.63 * (9 / 8), 1);
    // Index 3 = one octave above index 0.
    expect(tunedStepFrequency(spec, 3)).toBeCloseTo(261.63 * 2, 1);
    // Negative indices wrap: -1 is one octave below index 2.
    expect(tunedStepFrequency(spec, -1)).toBeCloseTo(261.63 * (5 / 4) * 0.5, 1);
  });

  it('tunedStepFrequency treats numbers as cents detune over 12-TET', () => {
    const plain = tunedStepFrequency(0, 4);
    const quarterToneUp = tunedStepFrequency(50, 4);
    expect(plain).toBeCloseTo(440 * 2 ** ((60 + 4 - 69) / 12), 2);
    expect((quarterToneUp ?? 0) > (plain ?? 0)).toBe(true);
    expect(quarterToneUp).toBeCloseTo((plain ?? 0) * 2 ** (50 / 1200), 6);
  });

  it('tunedStepFrequency accepts xen ratio strings', () => {
    expect(tunedStepFrequency('3/2', 0)).toBeCloseTo(261.63 * 1.5, 1);
  });

  it('getFreq resolves pitch names and MIDI numbers', () => {
    expect(getFreq('c3')).toBeCloseTo(130.81, 1);
    expect(getFreq(69)).toBeCloseTo(440, 2);
    expect(getFreq('nope')).toBeUndefined();
  });
});

describe('i() tuning-index source', () => {
  it('produces numeric step events', () => {
    const scene = defineScene({
      channels: { lead: { node: i('0 2 4') } },
      samples: [],
      transport: { cps: 1 },
    });
    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.map((event) => event.payload.i)).toEqual([0, 2, 4]);
  });

  it('carries the tune property through to the payload', () => {
    const scene = defineScene({
      channels: { lead: { node: i('0 8 16').tune('16edo').freq(220) } },
      samples: [],
      transport: { cps: 1 },
    });
    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.map((event) => event.payload.tune)).toEqual(['16edo', '16edo', '16edo']);
    expect(events.map((event) => event.payload.freq)).toEqual([220, 220, 220]);
    expect(events.map((event) => event.payload.i)).toEqual([0, 8, 16]);
  });
});

describe('midin() and midikeys() signals', () => {
  it('midin reads the latest note-on pitch from the registry', () => {
    setMidiNoteOn(64, 100);
    const scene = defineScene({
      channels: { lead: { node: note(midin()) } },
      samples: [],
      transport: { cps: 1 },
    });
    expect(queryScene(scene, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([64]);

    setMidiNoteOn(72, 100);
    expect(queryScene(scene, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([72]);
  });

  it('midikeys counts held notes', () => {
    setMidiNoteOn(60);
    setMidiNoteOn(64);
    const scene = defineScene({
      channels: { poly: { node: value(midikeys()) } },
      samples: [],
      transport: { cps: 1 },
    });
    expect(queryScene(scene, 0, 1, { cps: 1 }).map((event) => event.payload.value)).toEqual([2]);

    setMidiNoteOff(60);
    expect(queryScene(scene, 0, 1, { cps: 1 }).map((event) => event.payload.value)).toEqual([1]);
  });

  it('tracks ports independently', () => {
    setMidiNoteOn(48, 127, 'hw1');
    setMidiNoteOn(70, 127, 'hw2');
    const scene = defineScene({
      channels: {
        one: { node: note(midin('hw1')) },
        two: { node: note(midin('hw2')) },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.find((event) => event.channel === 'one')?.payload.note).toBe(48);
    expect(events.find((event) => event.channel === 'two')?.payload.note).toBe(70);
  });
});
