import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertSceneSpec,
  createCallExpression,
  createMethodExpression,
  getInputSnapshot,
  getInputValue,
  listCsoundInstruments,
  loadCsound,
  loadOrc,
  normalizeChannelSpec,
  normalizeHydraSceneSpec,
  normalizeSampleSource,
  parseCsoundInstruments,
  renderValue,
  resetCsoundRegistry,
  resetInputRegistry,
  resolveOrcUrl,
  setGamepadValue,
  setInputValue,
  setMidiValue,
  setMotionValue,
  stableJson,
  TusselInputError,
} from './index.js';

describe('@tussel/ir', () => {
  beforeEach(() => {
    resetCsoundRegistry();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetCsoundRegistry();
    resetInputRegistry();
  });

  it('normalizes shorthand sample and channel inputs', () => {
    expect(normalizeSampleSource('reference/assets/basic-kit')).toEqual({
      ref: 'reference/assets/basic-kit',
    });
    expect(normalizeChannelSpec(createCallExpression('s', ['bd'], 'pattern'))).toEqual({
      node: createCallExpression('s', ['bd'], 'pattern'),
    });
  });

  it('renders expression trees and stable JSON deterministically', () => {
    const value = {
      z: 2,
      a: createMethodExpression(createCallExpression('s', ['bd'], 'pattern'), 'gain', [0.5], 'pattern'),
    };

    expect(renderValue(value)).toBe('{ z: 2, a: s("bd").gain(0.5) }');
    expect(stableJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}\n',
    );
  });

  it('validates required scene structure with actionable errors', () => {
    expect(() =>
      assertSceneSpec({
        channels: { drums: { node: createCallExpression('s', ['bd'], 'pattern') } },
        samples: [],
        transport: {},
      }),
    ).not.toThrow();

    expect(() =>
      assertSceneSpec({
        channels: {},
        transport: {},
      }),
    ).toThrow('Scene.samples must be an array');
  });

  it('parses inline csound instruments and template-tag input', async () => {
    expect(
      parseCsoundInstruments(`instr One\nendin\ninstr Two\nendin`).map((instrument) => instrument.name),
    ).toEqual(['One', 'Two']);

    await loadCsound`instr CoolSynth
endin`;
    expect(listCsoundInstruments()).toContain('CoolSynth');
  });

  it('loads orchestras through github shorthand and discovers livecode instruments', async () => {
    const livecode = await readFile(
      path.resolve('.ref', 'strudel', 'packages', 'csound', 'livecode.orc'),
      'utf8',
    );
    const fetchMock = vi.fn(async () => new Response(livecode, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await loadOrc('github:kunstmusik/csound-live-code/master/livecode.orc');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/kunstmusik/csound-live-code/master/livecode.orc',
    );
    expect(resolveOrcUrl('github:kunstmusik/csound-live-code/master/livecode.orc')).toBe(
      'https://raw.githubusercontent.com/kunstmusik/csound-live-code/master/livecode.orc',
    );
    expect(listCsoundInstruments()).toContain('FM1');
    expect(listCsoundInstruments().length).toBeGreaterThan(40);
  });

  it('tracks external input state in a typed registry', () => {
    setInputValue('knob:one', 0.25);
    setMidiValue(74, 0.5);
    setGamepadValue('axis:0', 0.75, 1);
    setMotionValue('x', 0.9);

    expect(getInputValue('knob:one')).toBe(0.25);
    expect(getInputValue('midi:default:74')).toBe(0.5);
    expect(getInputValue('gamepad:1:axis:0')).toBe(0.75);
    expect(getInputValue('motion:x')).toBe(0.9);
    expect(getInputSnapshot()).toMatchObject({
      'gamepad:1:axis:0': 0.75,
      'knob:one': 0.25,
      'midi:default:74': 0.5,
      'motion:x': 0.9,
    });
    expect(() => setInputValue('', 1)).toThrow(TusselInputError);
  });

  it('normalizes hydra scene metadata', () => {
    expect(
      normalizeHydraSceneSpec({
        options: { detectAudio: true, feedStrudel: 1 },
        programs: [{ code: 'osc(10).out()' }, { code: 'shape(4).out(o0)' }],
      }),
    ).toEqual({
      options: { detectAudio: true, feedStrudel: 1 },
      programs: [{ code: 'osc(10).out()' }, { code: 'shape(4).out(o0)' }],
    });
  });
});
