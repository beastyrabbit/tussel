import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertSceneSpec,
  cloneExpressionValue,
  coerceFiniteNumber,
  collectCustomParamNames,
  createCallExpression,
  createMethodExpression,
  getCsoundInstrument,
  getInputSnapshot,
  getInputValue,
  hasCsoundInstrument,
  isExpressionNode,
  isExpressionValue,
  isPlainObject,
  isPrimitiveValue,
  listCsoundInstruments,
  loadCsound,
  loadOrc,
  normalizeChannelSpec,
  normalizeHydraSceneSpec,
  normalizeSampleSource,
  parseCsoundInstruments,
  registerCsoundCode,
  renderHydraPatternReference,
  renderHydraTemplate,
  renderValue,
  resetCsoundRegistry,
  resetInputRegistry,
  resolveGamepadInputKey,
  resolveInputKey,
  resolveMidiInputKey,
  resolveMotionInputKey,
  resolveOrcUrl,
  setGamepadValue,
  setInputValue,
  setMidiValue,
  setMotionValue,
  sortObject,
  stableJson,
  TusselAudioError,
  TusselCoreError,
  TusselError,
  TusselHydraError,
  TusselInputError,
  TusselParseError,
  TusselSchedulerError,
  TusselValidationError,
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
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
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

  describe('structured error types (Tier 1 — error taxonomy)', () => {
    it('assertSceneSpec throws TusselValidationError for non-object input', () => {
      expect(() => assertSceneSpec(null)).toThrow(TusselValidationError);
      expect(() => assertSceneSpec('not an object')).toThrow(TusselValidationError);
      expect(() => assertSceneSpec(42)).toThrow(TusselValidationError);
    });

    it('assertSceneSpec throws TusselValidationError for missing transport', () => {
      expect(() => assertSceneSpec({ channels: {}, samples: [] })).toThrow(
        'Scene.transport must be an object',
      );
    });

    it('assertSceneSpec throws TusselValidationError for missing samples', () => {
      expect(() => assertSceneSpec({ channels: {}, transport: {} })).toThrow(
        'Scene.samples must be an array',
      );
    });

    it('assertSceneSpec throws TusselValidationError for missing channels', () => {
      expect(() => assertSceneSpec({ samples: [], transport: {} })).toThrow(
        'Scene.channels must be an object',
      );
    });

    it('assertSceneSpec throws TusselValidationError for invalid channel node', () => {
      expect(() =>
        assertSceneSpec({
          channels: { bad: {} },
          samples: [],
          transport: {},
        }),
      ).toThrow('Scene.channels.bad must include a structural node');
    });

    it('loadOrc throws TusselInputError for invalid url', async () => {
      await expect(loadOrc('')).rejects.toThrow('loadOrc: expected url string');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // renderValue() — all value types
  // ──────────────────────────────────────────────────────────────────────────
  describe('renderValue()', () => {
    it('renders null', () => {
      expect(renderValue(null)).toBe('null');
    });

    it('renders numbers', () => {
      expect(renderValue(0)).toBe('0');
      expect(renderValue(42)).toBe('42');
      expect(renderValue(-3.14)).toBe('-3.14');
    });

    it('renders booleans', () => {
      expect(renderValue(true)).toBe('true');
      expect(renderValue(false)).toBe('false');
    });

    it('renders strings as JSON-quoted literals', () => {
      expect(renderValue('hello')).toBe('"hello"');
      expect(renderValue('')).toBe('""');
      expect(renderValue('with "quotes"')).toBe('"with \\"quotes\\""');
    });

    it('renders arrays including empty and nested', () => {
      expect(renderValue([])).toBe('[]');
      expect(renderValue([1, 'two', true])).toBe('[1, "two", true]');
      expect(renderValue([[1, 2], [3]])).toBe('[[1, 2], [3]]');
    });

    it('renders plain objects with key-value pairs', () => {
      expect(renderValue({})).toBe('{}');
      expect(renderValue({ x: 1, y: 2 })).toBe('{ x: 1, y: 2 }');
    });

    it('renders nested objects', () => {
      expect(renderValue({ outer: { inner: 42 } })).toBe('{ outer: { inner: 42 } }');
    });

    it('skips undefined values in objects', () => {
      expect(renderValue({ a: 1, b: undefined, c: 3 })).toBe('{ a: 1, c: 3 }');
    });

    it('quotes object keys that are not valid identifiers', () => {
      expect(renderValue({ 'a-b': 1 })).toBe('{ "a-b": 1 }');
      expect(renderValue({ '0start': 1 })).toBe('{ "0start": 1 }');
      expect(renderValue({ validKey: 1 })).toBe('{ validKey: 1 }');
      expect(renderValue({ $dollar: 1 })).toBe('{ $dollar: 1 }');
      expect(renderValue({ _under: 1 })).toBe('{ _under: 1 }');
    });

    it('renders call expressions', () => {
      const call = createCallExpression('note', ['c4', 'e4'], 'pattern');
      expect(renderValue(call)).toBe('note("c4", "e4")');
    });

    it('renders call expressions with no args', () => {
      const call = createCallExpression('silence', [], 'pattern');
      expect(renderValue(call)).toBe('silence()');
    });

    it('renders method expressions chained on call targets', () => {
      const call = createCallExpression('s', ['bd'], 'pattern');
      const method = createMethodExpression(call, 'gain', [0.8], 'pattern');
      expect(renderValue(method)).toBe('s("bd").gain(0.8)');
    });

    it('renders deeply chained method expressions', () => {
      const call = createCallExpression('s', ['hh'], 'pattern');
      const gain = createMethodExpression(call, 'gain', [0.5], 'pattern');
      const pan = createMethodExpression(gain, 'pan', [0.3], 'pattern');
      expect(renderValue(pan)).toBe('s("hh").gain(0.5).pan(0.3)');
    });

    it('renders signal identifiers without parentheses when args are empty', () => {
      for (const name of ['sine', 'saw', 'square', 'tri', 'triangle', 'rand', 'perlin']) {
        const sig = createCallExpression(name, [], 'signal');
        expect(renderValue(sig)).toBe(name);
      }
    });

    it('renders signal calls with args normally (not as bare identifiers)', () => {
      const sig = createCallExpression('sine', [440], 'signal');
      expect(renderValue(sig)).toBe('sine(440)');
    });

    it('throws TusselValidationError for non-structural values', () => {
      expect(() => renderValue(undefined)).toThrow(TusselValidationError);
      expect(() => renderValue(Symbol('bad'))).toThrow(TusselValidationError);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // stableJson() — deterministic key ordering
  // ──────────────────────────────────────────────────────────────────────────
  describe('stableJson()', () => {
    it('sorts top-level keys alphabetically', () => {
      const result = stableJson({ z: 1, a: 2, m: 3 });
      expect(result).toBe('{\n  "a": 2,\n  "m": 3,\n  "z": 1\n}\n');
    });

    it('sorts nested object keys recursively', () => {
      const result = stableJson({ b: { d: 1, c: 2 }, a: 3 });
      expect(result).toBe('{\n  "a": 3,\n  "b": {\n    "c": 2,\n    "d": 1\n  }\n}\n');
    });

    it('handles arrays without reordering elements', () => {
      const result = stableJson({ items: [3, 1, 2] });
      expect(result).toBe('{\n  "items": [\n    3,\n    1,\n    2\n  ]\n}\n');
    });

    it('sorts objects nested inside arrays', () => {
      const result = stableJson([{ z: 1, a: 2 }]);
      expect(result).toBe('[\n  {\n    "a": 2,\n    "z": 1\n  }\n]\n');
    });

    it('handles primitives at the top level', () => {
      expect(stableJson(42)).toBe('42\n');
      expect(stableJson('hello')).toBe('"hello"\n');
      expect(stableJson(null)).toBe('null\n');
      expect(stableJson(true)).toBe('true\n');
    });

    it('produces identical output regardless of insertion order', () => {
      const obj1 = { c: 3, a: 1, b: 2 };
      const obj2 = { a: 1, b: 2, c: 3 };
      const obj3 = { b: 2, c: 3, a: 1 };
      expect(stableJson(obj1)).toBe(stableJson(obj2));
      expect(stableJson(obj2)).toBe(stableJson(obj3));
    });

    it('supports custom indent parameter', () => {
      const result = stableJson({ a: 1 }, 4);
      expect(result).toBe('{\n    "a": 1\n}\n');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // assertSceneSpec() — additional validation paths
  // ──────────────────────────────────────────────────────────────────────────
  describe('assertSceneSpec() — comprehensive validation', () => {
    it('rejects arrays as input (array is not a plain object)', () => {
      expect(() => assertSceneSpec([])).toThrow('Scene must be an object');
    });

    it('rejects undefined', () => {
      expect(() => assertSceneSpec(undefined)).toThrow('Scene must be an object');
    });

    it('rejects boolean input', () => {
      expect(() => assertSceneSpec(true)).toThrow('Scene must be an object');
    });

    it('accepts a scene with transport containing bpm', () => {
      expect(() =>
        assertSceneSpec({
          channels: {},
          samples: [],
          transport: { bpm: 120 },
        }),
      ).not.toThrow();
    });

    it('rejects transport that is a non-object (array)', () => {
      expect(() =>
        assertSceneSpec({
          channels: {},
          samples: [],
          transport: [1, 2],
        }),
      ).toThrow('Scene.transport must be an object');
    });

    it('rejects channels that is an array instead of object', () => {
      expect(() =>
        assertSceneSpec({
          channels: ['bad'],
          samples: [],
          transport: {},
        }),
      ).toThrow('Scene.channels must be an object');
    });

    it('accepts multiple valid channels', () => {
      expect(() =>
        assertSceneSpec({
          channels: {
            drums: { node: createCallExpression('s', ['bd'], 'pattern') },
            bass: { node: createCallExpression('note', ['c2'], 'pattern') },
          },
          samples: [],
          transport: {},
        }),
      ).not.toThrow();
    });

    it('rejects channel where node is a non-expression value', () => {
      expect(() =>
        assertSceneSpec({
          channels: { bad: { node: Symbol('bad') } },
          samples: [],
          transport: {},
        }),
      ).toThrow('Scene.channels.bad must include a structural node');
    });

    it('rejects channel that is a string (not plain object)', () => {
      expect(() =>
        assertSceneSpec({
          channels: { bad: 'not-a-channel' },
          samples: [],
          transport: {},
        }),
      ).toThrow('Scene.channels.bad must include a structural node');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // normalizeChannelSpec() — full ChannelSpec objects
  // ──────────────────────────────────────────────────────────────────────────
  describe('normalizeChannelSpec()', () => {
    it('wraps a raw expression node in { node: ... }', () => {
      const node = createCallExpression('s', ['bd'], 'pattern');
      expect(normalizeChannelSpec(node)).toEqual({ node });
    });

    it('wraps a primitive expression value', () => {
      expect(normalizeChannelSpec(42 as any)).toEqual({ node: 42 });
      expect(normalizeChannelSpec('pattern-string' as any)).toEqual({ node: 'pattern-string' });
    });

    it('passes through a full ChannelSpec with gain, mute, orbit', () => {
      const node = createCallExpression('s', ['bd'], 'pattern');
      const input = { node, gain: 0.8, mute: true, orbit: 'bus1' };
      const result = normalizeChannelSpec(input);
      expect(result).toEqual({ node, gain: 0.8, mute: true, orbit: 'bus1' });
    });

    it('preserves node but drops non-matching extra properties', () => {
      const node = createCallExpression('s', ['bd'], 'pattern');
      const input = { node, extra: 'ignored' } as any;
      const result = normalizeChannelSpec(input);
      expect(result).toEqual({ node });
      expect(result).not.toHaveProperty('extra');
    });

    it('does not include gain if it is not an expression value', () => {
      const node = createCallExpression('s', ['bd'], 'pattern');
      const input = { node, gain: Symbol('bad') } as any;
      const result = normalizeChannelSpec(input);
      expect(result).not.toHaveProperty('gain');
    });

    it('does not include mute if it is not a boolean', () => {
      const node = createCallExpression('s', ['bd'], 'pattern');
      const input = { node, mute: 'yes' } as any;
      const result = normalizeChannelSpec(input);
      expect(result).not.toHaveProperty('mute');
    });

    it('does not include orbit if it is not a string', () => {
      const node = createCallExpression('s', ['bd'], 'pattern');
      const input = { node, orbit: 42 } as any;
      const result = normalizeChannelSpec(input);
      expect(result).not.toHaveProperty('orbit');
    });

    it('wraps an array expression as node', () => {
      const arr = [
        createCallExpression('s', ['bd'], 'pattern'),
        createCallExpression('s', ['hh'], 'pattern'),
      ];
      expect(normalizeChannelSpec(arr as any)).toEqual({ node: arr });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // normalizeSampleSource() — strings and objects
  // ──────────────────────────────────────────────────────────────────────────
  describe('normalizeSampleSource()', () => {
    it('converts a string to { ref: string }', () => {
      expect(normalizeSampleSource('my/samples')).toEqual({ ref: 'my/samples' });
    });

    it('extracts ref from a SampleSourceSpec object', () => {
      expect(normalizeSampleSource({ ref: 'my/samples' })).toEqual({ ref: 'my/samples' });
    });

    it('produces a clean object without extra properties', () => {
      const input = { ref: 'clean', extra: 'dropped' } as any;
      const result = normalizeSampleSource(input);
      expect(result).toEqual({ ref: 'clean' });
      expect(result).not.toHaveProperty('extra');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // isPlainObject() — edge cases
  // ──────────────────────────────────────────────────────────────────────────
  describe('isPlainObject()', () => {
    it('returns true for plain objects', () => {
      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject({ a: 1 })).toBe(true);
    });

    it('returns false for null', () => {
      expect(isPlainObject(null)).toBe(false);
    });

    it('returns false for arrays', () => {
      expect(isPlainObject([])).toBe(false);
      expect(isPlainObject([1, 2])).toBe(false);
    });

    it('returns false for primitives', () => {
      expect(isPlainObject(42)).toBe(false);
      expect(isPlainObject('string')).toBe(false);
      expect(isPlainObject(true)).toBe(false);
      expect(isPlainObject(undefined)).toBe(false);
    });

    it('returns true for class instances (because typeof is object and not array)', () => {
      expect(isPlainObject(new Date())).toBe(true);
      expect(isPlainObject(new Map())).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // isExpressionNode() — edge cases
  // ──────────────────────────────────────────────────────────────────────────
  describe('isExpressionNode()', () => {
    it('recognizes call expression nodes', () => {
      expect(isExpressionNode(createCallExpression('s', ['bd'], 'pattern'))).toBe(true);
    });

    it('recognizes method expression nodes', () => {
      const call = createCallExpression('s', ['bd'], 'pattern');
      expect(isExpressionNode(createMethodExpression(call, 'gain', [0.5], 'pattern'))).toBe(true);
    });

    it('rejects objects without kind field', () => {
      expect(isExpressionNode({ name: 's', args: [], exprType: 'pattern' })).toBe(false);
    });

    it('rejects call-kind objects missing required fields', () => {
      expect(isExpressionNode({ kind: 'call' })).toBe(false);
      expect(isExpressionNode({ kind: 'call', name: 's' })).toBe(false);
      expect(isExpressionNode({ kind: 'call', name: 's', args: 'not-array', exprType: 'pattern' })).toBe(
        false,
      );
      expect(isExpressionNode({ kind: 'call', name: 123, args: [], exprType: 'pattern' })).toBe(false);
    });

    it('rejects method-kind objects missing target', () => {
      expect(isExpressionNode({ kind: 'method', name: 'gain', args: [], exprType: 'pattern' })).toBe(false);
    });

    it('rejects primitives and arrays', () => {
      expect(isExpressionNode(null)).toBe(false);
      expect(isExpressionNode(42)).toBe(false);
      expect(isExpressionNode('string')).toBe(false);
      expect(isExpressionNode([1, 2])).toBe(false);
    });

    it('rejects objects with unknown kind values', () => {
      expect(isExpressionNode({ kind: 'unknown', name: 's', args: [], exprType: 'pattern' })).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // isExpressionValue() — composite value detection
  // ──────────────────────────────────────────────────────────────────────────
  describe('isExpressionValue()', () => {
    it('returns true for all primitive types', () => {
      expect(isExpressionValue(null)).toBe(true);
      expect(isExpressionValue(0)).toBe(true);
      expect(isExpressionValue(42)).toBe(true);
      expect(isExpressionValue('hello')).toBe(true);
      expect(isExpressionValue(true)).toBe(true);
      expect(isExpressionValue(false)).toBe(true);
    });

    it('returns true for expression nodes', () => {
      expect(isExpressionValue(createCallExpression('s', ['bd'], 'pattern'))).toBe(true);
    });

    it('returns true for arrays of expression values', () => {
      expect(isExpressionValue([1, 'two', null])).toBe(true);
      expect(isExpressionValue([createCallExpression('s', ['bd'], 'pattern'), 42])).toBe(true);
    });

    it('returns true for plain objects with expression values', () => {
      expect(isExpressionValue({ a: 1, b: 'two' })).toBe(true);
    });

    it('returns false for arrays containing non-expression values', () => {
      expect(isExpressionValue([Symbol('bad')])).toBe(false);
    });

    it('returns false for objects containing non-expression values', () => {
      expect(isExpressionValue({ a: Symbol('bad') })).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isExpressionValue(undefined)).toBe(false);
    });

    it('returns false for functions', () => {
      expect(isExpressionValue(() => {})).toBe(false);
    });

    it('handles deeply nested valid structures', () => {
      expect(isExpressionValue({ a: { b: [1, { c: 'deep' }] } })).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // isPrimitiveValue()
  // ──────────────────────────────────────────────────────────────────────────
  describe('isPrimitiveValue()', () => {
    it('returns true for null, string, number, boolean', () => {
      expect(isPrimitiveValue(null)).toBe(true);
      expect(isPrimitiveValue(0)).toBe(true);
      expect(isPrimitiveValue('')).toBe(true);
      expect(isPrimitiveValue(false)).toBe(true);
    });

    it('returns false for objects, arrays, undefined, functions', () => {
      expect(isPrimitiveValue({})).toBe(false);
      expect(isPrimitiveValue([])).toBe(false);
      expect(isPrimitiveValue(undefined)).toBe(false);
      expect(isPrimitiveValue(() => {})).toBe(false);
      expect(isPrimitiveValue(Symbol('x'))).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // createCallExpression() / createMethodExpression() — factory correctness
  // ──────────────────────────────────────────────────────────────────────────
  describe('createCallExpression()', () => {
    it('creates a call node with all fields', () => {
      const node = createCallExpression('note', ['c4'], 'pattern');
      expect(node).toEqual({ kind: 'call', name: 'note', args: ['c4'], exprType: 'pattern' });
    });

    it('defaults exprType to "value" when omitted', () => {
      const node = createCallExpression('fn', [1, 2]);
      expect(node.exprType).toBe('value');
    });

    it('handles empty args', () => {
      const node = createCallExpression('silence', []);
      expect(node.args).toEqual([]);
    });

    it('preserves complex nested args', () => {
      const inner = createCallExpression('inner', [], 'pattern');
      const node = createCallExpression('outer', [inner, { key: 'val' }], 'pattern');
      expect(node.args).toHaveLength(2);
      expect(node.args[0]).toEqual(inner);
    });
  });

  describe('createMethodExpression()', () => {
    it('creates a method node with all fields', () => {
      const target = createCallExpression('s', ['bd'], 'pattern');
      const node = createMethodExpression(target, 'gain', [0.5], 'pattern');
      expect(node).toEqual({
        kind: 'method',
        name: 'gain',
        target,
        args: [0.5],
        exprType: 'pattern',
      });
    });

    it('defaults exprType to "value" when omitted', () => {
      const target = createCallExpression('s', ['bd'], 'pattern');
      const node = createMethodExpression(target, 'gain', [0.5]);
      expect(node.exprType).toBe('value');
    });

    it('allows primitive target', () => {
      const node = createMethodExpression(42, 'mul', [2], 'value');
      expect(node.target).toBe(42);
      expect(renderValue(node)).toBe('42.mul(2)');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // coerceFiniteNumber() — edge cases
  // ──────────────────────────────────────────────────────────────────────────
  describe('coerceFiniteNumber()', () => {
    it('returns the number for finite numbers', () => {
      expect(coerceFiniteNumber(42)).toBe(42);
      expect(coerceFiniteNumber(0)).toBe(0);
      expect(coerceFiniteNumber(-3.14)).toBe(-3.14);
    });

    it('returns undefined for NaN', () => {
      expect(coerceFiniteNumber(NaN)).toBeUndefined();
    });

    it('returns undefined for Infinity and -Infinity', () => {
      expect(coerceFiniteNumber(Infinity)).toBeUndefined();
      expect(coerceFiniteNumber(-Infinity)).toBeUndefined();
    });

    it('parses valid numeric strings', () => {
      expect(coerceFiniteNumber('42')).toBe(42);
      expect(coerceFiniteNumber('  3.14  ')).toBe(3.14);
      expect(coerceFiniteNumber('-100')).toBe(-100);
      expect(coerceFiniteNumber('0')).toBe(0);
    });

    it('returns undefined for non-numeric strings', () => {
      expect(coerceFiniteNumber('abc')).toBeUndefined();
      expect(coerceFiniteNumber('Infinity')).toBeUndefined();
      expect(coerceFiniteNumber('NaN')).toBeUndefined();
    });

    it('coerces empty string to 0 (Number("") === 0)', () => {
      expect(coerceFiniteNumber('')).toBe(0);
    });

    it('returns undefined for null, undefined, boolean, object', () => {
      expect(coerceFiniteNumber(null)).toBeUndefined();
      expect(coerceFiniteNumber(undefined)).toBeUndefined();
      expect(coerceFiniteNumber(true)).toBeUndefined();
      expect(coerceFiniteNumber(false)).toBeUndefined();
      expect(coerceFiniteNumber({})).toBeUndefined();
      expect(coerceFiniteNumber([])).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Error types — TusselError taxonomy
  // ──────────────────────────────────────────────────────────────────────────
  describe('TusselError hierarchy', () => {
    it('TusselError has default code TUSSEL_ERROR', () => {
      const err = new TusselError('test');
      expect(err.message).toBe('test');
      expect(err.code).toBe('TUSSEL_ERROR');
      expect(err.name).toBe('TusselError');
      expect(err).toBeInstanceOf(Error);
    });

    it('TusselError accepts custom code and details', () => {
      const err = new TusselError('test', { code: 'CUSTOM', details: { field: 'a' } });
      expect(err.code).toBe('CUSTOM');
      expect(err.details).toEqual({ field: 'a' });
    });

    it('TusselError forwards cause', () => {
      const cause = new Error('original');
      const err = new TusselError('wrapped', { cause });
      expect(err.cause).toBe(cause);
    });

    it('TusselError without cause does not set cause property', () => {
      const err = new TusselError('no cause');
      expect(err.cause).toBeUndefined();
    });

    it('TusselValidationError defaults to TUSSEL_VALIDATION_ERROR', () => {
      const err = new TusselValidationError('bad input');
      expect(err.code).toBe('TUSSEL_VALIDATION_ERROR');
      expect(err.name).toBe('TusselValidationError');
      expect(err).toBeInstanceOf(TusselError);
      expect(err).toBeInstanceOf(Error);
    });

    it('TusselInputError defaults to TUSSEL_INPUT_ERROR', () => {
      const err = new TusselInputError('bad key');
      expect(err.code).toBe('TUSSEL_INPUT_ERROR');
      expect(err.name).toBe('TusselInputError');
      expect(err).toBeInstanceOf(TusselError);
    });

    it('TusselHydraError defaults to TUSSEL_HYDRA_ERROR', () => {
      const err = new TusselHydraError('hydra fail');
      expect(err.code).toBe('TUSSEL_HYDRA_ERROR');
      expect(err.name).toBe('TusselHydraError');
      expect(err).toBeInstanceOf(TusselError);
    });

    it('TusselAudioError defaults to TUSSEL_AUDIO_ERROR', () => {
      const err = new TusselAudioError('audio fail');
      expect(err.code).toBe('TUSSEL_AUDIO_ERROR');
      expect(err.name).toBe('TusselAudioError');
      expect(err).toBeInstanceOf(TusselError);
    });

    it('TusselSchedulerError defaults to TUSSEL_SCHEDULER_ERROR', () => {
      const err = new TusselSchedulerError('scheduler fail');
      expect(err.code).toBe('TUSSEL_SCHEDULER_ERROR');
      expect(err.name).toBe('TusselSchedulerError');
      expect(err).toBeInstanceOf(TusselError);
    });

    it('TusselCoreError defaults to TUSSEL_CORE_ERROR', () => {
      const err = new TusselCoreError('core fail');
      expect(err.code).toBe('TUSSEL_CORE_ERROR');
      expect(err.name).toBe('TusselCoreError');
      expect(err).toBeInstanceOf(TusselError);
    });

    it('TusselParseError defaults to TUSSEL_PARSE_ERROR', () => {
      const err = new TusselParseError('parse fail');
      expect(err.code).toBe('TUSSEL_PARSE_ERROR');
      expect(err.name).toBe('TusselParseError');
      expect(err).toBeInstanceOf(TusselError);
    });

    it('subclasses allow code override', () => {
      const err = new TusselValidationError('test', { code: 'CUSTOM_VAL' });
      expect(err.code).toBe('CUSTOM_VAL');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Csound — parseCsoundInstruments, registerCsoundCode, getCsoundInstrument
  // ──────────────────────────────────────────────────────────────────────────
  describe('Csound module', () => {
    describe('parseCsoundInstruments()', () => {
      it('parses a single instrument', () => {
        const result = parseCsoundInstruments('instr MySynth\n  aout oscil 0.5, 440\nendin');
        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe('MySynth');
        expect(result[0]!.body).toBe('aout oscil 0.5, 440');
        expect(result[0]!.source).toBe('inline');
      });

      it('parses multiple instruments', () => {
        const code = `instr Alpha\n  line 1\nendin\ninstr Beta\n  line 2\nendin\ninstr Gamma\n  line 3\nendin`;
        const result = parseCsoundInstruments(code);
        expect(result.map((i) => i.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
      });

      it('returns empty array for code with no instruments', () => {
        expect(parseCsoundInstruments('')).toEqual([]);
        expect(parseCsoundInstruments('some random text')).toEqual([]);
        expect(parseCsoundInstruments('instr\nendin')).toEqual([]);
      });

      it('uses custom source label', () => {
        const result = parseCsoundInstruments('instr Test\nendin', 'custom-file.orc');
        expect(result[0]!.source).toBe('custom-file.orc');
      });

      it('handles instruments with numeric names', () => {
        const result = parseCsoundInstruments('instr 1\n  aout = 0\nendin');
        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe('1');
      });

      it('handles instruments with leading whitespace', () => {
        const result = parseCsoundInstruments('  instr Padded\n    body\n  endin');
        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe('Padded');
      });

      it('parses instrument with empty body', () => {
        const result = parseCsoundInstruments('instr Empty\nendin');
        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe('Empty');
        expect(result[0]!.body).toBe('');
      });
    });

    describe('registerCsoundCode()', () => {
      it('registers instruments and returns their names', () => {
        const names = registerCsoundCode('instr A\nendin\ninstr B\nendin');
        expect(names).toEqual(['A', 'B']);
        expect(listCsoundInstruments()).toEqual(['A', 'B']);
      });

      it('overwrites previously registered instruments with same name', () => {
        registerCsoundCode('instr Dup\n  body1\nendin');
        registerCsoundCode('instr Dup\n  body2\nendin');
        const spec = getCsoundInstrument('Dup');
        expect(spec!.body).toBe('body2');
      });

      it('returns empty array for code with no instruments', () => {
        expect(registerCsoundCode('no instruments here')).toEqual([]);
      });

      it('uses custom source label', () => {
        registerCsoundCode('instr FromFile\nendin', 'my-file.orc');
        expect(getCsoundInstrument('FromFile')!.source).toBe('my-file.orc');
      });
    });

    describe('getCsoundInstrument()', () => {
      it('returns undefined for unregistered instrument', () => {
        expect(getCsoundInstrument('Nonexistent')).toBeUndefined();
      });

      it('returns undefined for empty name', () => {
        expect(getCsoundInstrument('')).toBeUndefined();
        expect(getCsoundInstrument('  ')).toBeUndefined();
      });

      it('returns a copy (not a reference) of the spec', () => {
        registerCsoundCode('instr Copyable\n  body\nendin');
        const spec1 = getCsoundInstrument('Copyable');
        const spec2 = getCsoundInstrument('Copyable');
        expect(spec1).toEqual(spec2);
        expect(spec1).not.toBe(spec2);
      });

      it('accepts numeric names', () => {
        registerCsoundCode('instr 42\n  body\nendin');
        expect(getCsoundInstrument(42)).toEqual({ name: '42', body: 'body', source: 'inline' });
      });
    });

    describe('hasCsoundInstrument()', () => {
      it('returns false for unregistered, true for registered', () => {
        expect(hasCsoundInstrument('Nope')).toBe(false);
        registerCsoundCode('instr Yep\nendin');
        expect(hasCsoundInstrument('Yep')).toBe(true);
      });
    });

    describe('resolveOrcUrl()', () => {
      it('resolves github: shorthand to raw.githubusercontent.com URL', () => {
        expect(resolveOrcUrl('github:user/repo/main/file.orc')).toBe(
          'https://raw.githubusercontent.com/user/repo/main/file.orc',
        );
      });

      it('returns non-github URLs as-is after trimming', () => {
        expect(resolveOrcUrl('  https://example.com/file.orc  ')).toBe('https://example.com/file.orc');
      });

      it('throws TusselInputError for empty string', () => {
        expect(() => resolveOrcUrl('')).toThrow(TusselInputError);
        expect(() => resolveOrcUrl('   ')).toThrow(TusselInputError);
      });
    });

    describe('loadCsound() template tag', () => {
      it('registers instruments from plain string', async () => {
        await loadCsound`instr TagInstr
  aout = 0
endin`;
        expect(hasCsoundInstrument('TagInstr')).toBe(true);
      });

      it('handles interpolated values in template', async () => {
        const name = 'Dynamic';
        await loadCsound`instr ${name}
endin`;
        expect(hasCsoundInstrument('Dynamic')).toBe(true);
      });
    });

    describe('resetCsoundRegistry()', () => {
      it('clears all registered instruments', () => {
        registerCsoundCode('instr ToBeCleared\nendin');
        expect(hasCsoundInstrument('ToBeCleared')).toBe(true);
        resetCsoundRegistry();
        expect(hasCsoundInstrument('ToBeCleared')).toBe(false);
        expect(listCsoundInstruments()).toEqual([]);
      });
    });

    describe('listCsoundInstruments()', () => {
      it('returns instrument names in sorted order', () => {
        registerCsoundCode('instr Zebra\nendin\ninstr Alpha\nendin\ninstr Middle\nendin');
        expect(listCsoundInstruments()).toEqual(['Alpha', 'Middle', 'Zebra']);
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Input module — resolve keys, edge cases
  // ──────────────────────────────────────────────────────────────────────────
  describe('Input module', () => {
    describe('resolveInputKey()', () => {
      it('trims and returns the key', () => {
        expect(resolveInputKey('  knob:one  ')).toBe('knob:one');
      });

      it('throws TusselInputError for empty string', () => {
        expect(() => resolveInputKey('')).toThrow(TusselInputError);
        expect(() => resolveInputKey('   ')).toThrow(TusselInputError);
      });
    });

    describe('resolveMidiInputKey()', () => {
      it('builds default port key from numeric control', () => {
        expect(resolveMidiInputKey(74)).toBe('midi:default:74');
      });

      it('builds key with custom port', () => {
        expect(resolveMidiInputKey('cc1', 'port-a')).toBe('midi:port-a:cc1');
      });

      it('trims whitespace from port and control', () => {
        expect(resolveMidiInputKey(' 74 ', '  port  ')).toBe('midi:port:74');
      });
    });

    describe('resolveGamepadInputKey()', () => {
      it('builds key with default index 0', () => {
        expect(resolveGamepadInputKey('button:0')).toBe('gamepad:0:button:0');
      });

      it('builds key with custom index', () => {
        expect(resolveGamepadInputKey('axis:1', 2)).toBe('gamepad:2:axis:1');
      });

      it('truncates negative index to 0', () => {
        expect(resolveGamepadInputKey('axis:0', -5)).toBe('gamepad:0:axis:0');
      });

      it('truncates fractional index', () => {
        expect(resolveGamepadInputKey('axis:0', 1.9)).toBe('gamepad:1:axis:0');
      });
    });

    describe('resolveMotionInputKey()', () => {
      it('builds motion key', () => {
        expect(resolveMotionInputKey('x')).toBe('motion:x');
        expect(resolveMotionInputKey('y')).toBe('motion:y');
        expect(resolveMotionInputKey('z')).toBe('motion:z');
      });
    });

    describe('getInputValue() fallback', () => {
      it('returns fallback value when key is not set', () => {
        expect(getInputValue('nonexistent')).toBe(0);
        expect(getInputValue('nonexistent', 99)).toBe(99);
        expect(getInputValue('nonexistent', null)).toBeNull();
      });

      it('returns set value instead of fallback', () => {
        setInputValue('test:key', 42);
        expect(getInputValue('test:key', 0)).toBe(42);
      });
    });

    describe('setInputValue() with various types', () => {
      it('stores and retrieves boolean values', () => {
        setInputValue('toggle:a', true);
        expect(getInputValue('toggle:a')).toBe(true);
        setInputValue('toggle:a', false);
        expect(getInputValue('toggle:a')).toBe(false);
      });

      it('stores and retrieves null', () => {
        setInputValue('null:key', null);
        // null ?? fallback -> uses fallback because null is nullish
        expect(getInputValue('null:key')).toBe(0);
      });

      it('stores and retrieves string values', () => {
        setInputValue('text:key', 'hello');
        expect(getInputValue('text:key')).toBe('hello');
      });
    });

    describe('getInputSnapshot()', () => {
      it('returns empty object when no inputs set', () => {
        expect(getInputSnapshot()).toEqual({});
      });

      it('returns all entries sorted alphabetically', () => {
        setInputValue('z:key', 1);
        setInputValue('a:key', 2);
        setInputValue('m:key', 3);
        const snapshot = getInputSnapshot();
        const keys = Object.keys(snapshot);
        expect(keys).toEqual(['a:key', 'm:key', 'z:key']);
      });
    });

    describe('resetInputRegistry()', () => {
      it('clears all input values', () => {
        setInputValue('key1', 1);
        setInputValue('key2', 2);
        resetInputRegistry();
        expect(getInputSnapshot()).toEqual({});
        expect(getInputValue('key1')).toBe(0);
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Hydra module
  // ──────────────────────────────────────────────────────────────────────────
  describe('Hydra module', () => {
    describe('normalizeHydraSceneSpec()', () => {
      it('returns undefined for null, undefined, non-objects', () => {
        expect(normalizeHydraSceneSpec(null)).toBeUndefined();
        expect(normalizeHydraSceneSpec(undefined)).toBeUndefined();
        expect(normalizeHydraSceneSpec('string')).toBeUndefined();
        expect(normalizeHydraSceneSpec(42)).toBeUndefined();
      });

      it('returns undefined for arrays', () => {
        expect(normalizeHydraSceneSpec([1, 2])).toBeUndefined();
      });

      it('returns undefined for empty object (no programs, no options)', () => {
        expect(normalizeHydraSceneSpec({})).toBeUndefined();
      });

      it('defaults options to empty object when not provided', () => {
        const result = normalizeHydraSceneSpec({ programs: [{ code: 'osc().out()' }] });
        expect(result).toEqual({ options: {}, programs: [{ code: 'osc().out()' }] });
      });

      it('defaults options to empty object when options is an array', () => {
        const result = normalizeHydraSceneSpec({ options: [1, 2], programs: [{ code: 'osc().out()' }] });
        expect(result).toEqual({ options: {}, programs: [{ code: 'osc().out()' }] });
      });

      it('filters out programs with empty or whitespace-only code', () => {
        const result = normalizeHydraSceneSpec({
          programs: [{ code: '' }, { code: '   ' }, { code: 'valid()' }],
        });
        expect(result!.programs).toEqual([{ code: 'valid()' }]);
      });

      it('filters out program entries that are not objects with code string', () => {
        const result = normalizeHydraSceneSpec({
          programs: [null, 42, 'not-obj', { noCode: true }, { code: 123 }, { code: 'ok()' }],
        });
        expect(result!.programs).toEqual([{ code: 'ok()' }]);
      });

      it('returns undefined when all programs are filtered out and options is empty', () => {
        expect(normalizeHydraSceneSpec({ programs: [{ code: '' }] })).toBeUndefined();
      });

      it('returns result when there are only options but no valid programs', () => {
        const result = normalizeHydraSceneSpec({ options: { detectAudio: true } });
        expect(result).toEqual({ options: { detectAudio: true }, programs: [] });
      });

      it('handles programs being a non-array', () => {
        const result = normalizeHydraSceneSpec({ options: { a: 1 }, programs: 'not-array' });
        expect(result).toEqual({ options: { a: 1 }, programs: [] });
      });
    });

    describe('renderHydraTemplate()', () => {
      it('returns the string directly for string input', () => {
        expect(renderHydraTemplate('osc(10).out()', [])).toBe('osc(10).out()');
      });

      it('interpolates template strings array with values', () => {
        // Simulate tagged template: hydra`osc(${10}).out(${o0})`
        const strings = Object.assign(['osc(', ').out(', ')'], { raw: ['osc(', ').out(', ')'] });
        expect(renderHydraTemplate(strings as unknown as TemplateStringsArray, [10, 'o0'])).toBe(
          'osc(10).out(o0)',
        );
      });

      it('handles template with no interpolations', () => {
        const strings = Object.assign(['osc().out()'], { raw: ['osc().out()'] });
        expect(renderHydraTemplate(strings as unknown as TemplateStringsArray, [])).toBe('osc().out()');
      });

      it('treats null/undefined values as empty string', () => {
        const strings = Object.assign(['a', 'b', 'c'], { raw: ['a', 'b', 'c'] });
        expect(renderHydraTemplate(strings as unknown as TemplateStringsArray, [null, undefined])).toBe(
          'abc',
        );
      });
    });

    describe('renderHydraPatternReference()', () => {
      it('renders string value with JSON quoting', () => {
        expect(renderHydraPatternReference('drums')).toBe('H("drums")');
      });

      it('renders numeric value with toString', () => {
        expect(renderHydraPatternReference(42)).toBe('H(42)');
      });

      it('renders boolean value', () => {
        expect(renderHydraPatternReference(true)).toBe('H(true)');
      });

      it('throws TusselHydraError for undefined', () => {
        expect(() => renderHydraPatternReference(undefined)).toThrow(TusselHydraError);
        expect(() => renderHydraPatternReference(undefined)).toThrow(
          'H() requires a value or pattern reference.',
        );
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // cloneExpressionValue() — deep copy semantics
  // ──────────────────────────────────────────────────────────────────────────
  describe('cloneExpressionValue()', () => {
    it('clones primitive values (passthrough)', () => {
      expect(cloneExpressionValue(42)).toBe(42);
      expect(cloneExpressionValue('hello')).toBe('hello');
      expect(cloneExpressionValue(null)).toBeNull();
      expect(cloneExpressionValue(true)).toBe(true);
    });

    it('deep-clones a call expression node', () => {
      const original = createCallExpression('s', ['bd'], 'pattern');
      const cloned = cloneExpressionValue(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.args).not.toBe(original.args);
    });

    it('deep-clones a method expression node', () => {
      const call = createCallExpression('s', ['bd'], 'pattern');
      const original = createMethodExpression(call, 'gain', [0.5], 'pattern');
      const cloned = cloneExpressionValue(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
    });

    it('deep-clones arrays of expression values', () => {
      const original = [1, 'two', createCallExpression('s', ['bd'], 'pattern')];
      const cloned = cloneExpressionValue(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned[2]).not.toBe(original[2]);
    });

    it('deep-clones plain objects of expression values', () => {
      const original = { a: 1, b: createCallExpression('note', ['c4'], 'pattern') };
      const cloned = cloneExpressionValue(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.b).not.toBe(original.b);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // sortObject() — key ordering
  // ──────────────────────────────────────────────────────────────────────────
  describe('sortObject()', () => {
    it('sorts top-level keys alphabetically', () => {
      const result = sortObject({ z: 1, a: 2, m: 3 });
      expect(Object.keys(result)).toEqual(['a', 'm', 'z']);
    });

    it('sorts nested objects recursively', () => {
      const result = sortObject({ z: { b: 2, a: 1 }, a: 3 });
      expect(Object.keys(result)).toEqual(['a', 'z']);
      expect(Object.keys(result.z as Record<string, unknown>)).toEqual(['a', 'b']);
    });

    it('sorts objects within arrays', () => {
      const result = sortObject({ items: [{ z: 1, a: 2 }] });
      const item = (result.items as Record<string, unknown>[])[0]!;
      expect(Object.keys(item)).toEqual(['a', 'z']);
    });

    it('does not modify non-object array elements', () => {
      const result = sortObject({ items: [3, 1, 2] });
      expect(result.items).toEqual([3, 1, 2]);
    });

    it('preserves primitive values', () => {
      const result = sortObject({ b: 'hello', a: 42 });
      expect(result).toEqual({ a: 42, b: 'hello' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // collectCustomParamNames() — tree walking
  // ──────────────────────────────────────────────────────────────────────────
  describe('collectCustomParamNames()', () => {
    const builtinCalls = new Set(['s', 'note', 'n']);
    const builtinMethods = new Set(['gain', 'pan']);

    it('identifies custom call names not in builtins', () => {
      const node = createCallExpression('myCustom', [], 'pattern');
      const names = collectCustomParamNames(node, builtinCalls, builtinMethods);
      expect(names).toContain('myCustom');
    });

    it('does not include builtin call names', () => {
      const node = createCallExpression('s', ['bd'], 'pattern');
      const names = collectCustomParamNames(node, builtinCalls, builtinMethods);
      expect(names).not.toContain('s');
    });

    it('identifies custom method names not in builtins', () => {
      const call = createCallExpression('s', ['bd'], 'pattern');
      const method = createMethodExpression(call, 'myEffect', [0.5], 'pattern');
      const names = collectCustomParamNames(method, builtinCalls, builtinMethods);
      expect(names).toContain('myEffect');
      expect(names).not.toContain('s');
    });

    it('does not include builtin method names', () => {
      const call = createCallExpression('s', ['bd'], 'pattern');
      const method = createMethodExpression(call, 'gain', [0.5], 'pattern');
      const names = collectCustomParamNames(method, builtinCalls, builtinMethods);
      expect(names).not.toContain('gain');
    });

    it('collects from arrays', () => {
      const nodes = [
        createCallExpression('custom1', [], 'pattern'),
        createCallExpression('s', [], 'pattern'),
        createCallExpression('custom2', [], 'pattern'),
      ];
      const names = collectCustomParamNames(nodes, builtinCalls, builtinMethods);
      expect(names).toEqual(new Set(['custom1', 'custom2']));
    });

    it('collects from plain objects', () => {
      const obj = {
        ch1: createCallExpression('custom', [], 'pattern'),
        ch2: createCallExpression('s', [], 'pattern'),
      };
      const names = collectCustomParamNames(obj, builtinCalls, builtinMethods);
      expect(names).toContain('custom');
      expect(names).not.toContain('s');
    });

    it('recurses into nested args', () => {
      const inner = createCallExpression('nestedCustom', [], 'pattern');
      const outer = createCallExpression('s', [inner], 'pattern');
      const names = collectCustomParamNames(outer, builtinCalls, builtinMethods);
      expect(names).toContain('nestedCustom');
    });

    it('returns empty set for primitives', () => {
      expect(collectCustomParamNames(42, builtinCalls, builtinMethods).size).toBe(0);
      expect(collectCustomParamNames('string', builtinCalls, builtinMethods).size).toBe(0);
      expect(collectCustomParamNames(null, builtinCalls, builtinMethods).size).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // loadOrc() — fetch error paths
  // ──────────────────────────────────────────────────────────────────────────
  describe('loadOrc() fetch error handling', () => {
    it('throws TusselInputError for non-OK response', async () => {
      const fetchMock = vi.fn(
        async () => new Response('Not Found', { status: 404, statusText: 'Not Found' }),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(loadOrc('https://example.com/missing.orc')).rejects.toThrow('failed to fetch');
    });

    it('throws TusselInputError for unexpected content-type', async () => {
      const headers = new Headers({ 'content-type': 'application/json' });
      const fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(loadOrc('https://example.com/file.orc')).rejects.toThrow('unexpected content-type');
    });

    it('throws TusselInputError for oversized content-length', async () => {
      const headers = new Headers({ 'content-type': 'text/plain', 'content-length': '2000000' });
      const fetchMock = vi.fn(async () => new Response('big', { status: 200, headers }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(loadOrc('https://example.com/huge.orc')).rejects.toThrow('response too large');
    });

    it('deduplicates concurrent loads for the same URL', async () => {
      const fetchMock = vi.fn(async () => new Response('instr Dedup\nendin', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      await Promise.all([loadOrc('https://example.com/dedup.orc'), loadOrc('https://example.com/dedup.orc')]);
      // fetch should only be called once due to deduplication
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(hasCsoundInstrument('Dedup')).toBe(true);
    });
  });
});
