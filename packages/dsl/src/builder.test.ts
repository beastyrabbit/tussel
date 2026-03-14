import {
  areStringPrototypeExtensionsInstalled,
  cat,
  cosine,
  createParam,
  createParams,
  defineScene,
  installStringPrototypeExtensions,
  note,
  PatternBuilder,
  perlin,
  rand,
  SceneRecorder,
  SignalBuilder,
  s,
  saw,
  seq,
  silence,
  sine,
  square,
  stack,
  tri,
  triangle,
  uninstallStringPrototypeExtensions,
} from '@tussel/dsl';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  while (areStringPrototypeExtensionsInstalled()) {
    uninstallStringPrototypeExtensions();
  }
});

// ---------------------------------------------------------------------------
// PatternBuilder deep chaining
// ---------------------------------------------------------------------------
describe('PatternBuilder deep chaining', () => {
  it('produces correct expression tree for s("bd").fast(2).slow(3).gain(0.5)', () => {
    const result = s('bd').fast(2).slow(3).gain(0.5);
    expect(result).toBeInstanceOf(PatternBuilder);
    expect(result.show()).toBe('s("bd").fast(2).slow(3).gain(0.5)');
  });

  it('each chained call returns a new PatternBuilder (immutable)', () => {
    const base = s('bd');
    const withFast = base.fast(2);
    const withSlow = withFast.slow(3);

    expect(base.show()).toBe('s("bd")');
    expect(withFast.show()).toBe('s("bd").fast(2)');
    expect(withSlow.show()).toBe('s("bd").fast(2).slow(3)');
  });

  it('handles long chains without errors', () => {
    const result = s('bd')
      .fast(2)
      .slow(3)
      .gain(0.5)
      .pan(0.3)
      .speed(1.5)
      .cut(1)
      .orbit(0)
      .room(0.5)
      .size(4)
      .delay(0.25)
      .begin(0.1)
      .end(0.9);
    expect(result).toBeInstanceOf(PatternBuilder);
    expect(result.show()).toBe(
      's("bd").fast(2).slow(3).gain(0.5).pan(0.3).speed(1.5).cut(1).orbit(0).room(0.5).size(4).delay(0.25).begin(0.1).end(0.9)',
    );
  });
});

// ---------------------------------------------------------------------------
// Pattern methods produce valid expression nodes
// ---------------------------------------------------------------------------
describe('PatternBuilder methods produce valid expression nodes', () => {
  it('ceil() produces a method expression', () => {
    const result = s('bd').ceil();
    const json = result.toJSON();
    expect(json.kind).toBe('method');
    expect(json.name).toBe('ceil');
    expect(json.exprType).toBe('pattern');
  });

  it('floor() produces a method expression', () => {
    const result = s('bd').floor();
    const json = result.toJSON();
    expect(json.kind).toBe('method');
    expect(json.name).toBe('floor');
  });

  it('rev() produces a method expression', () => {
    const result = s('bd').rev();
    const json = result.toJSON();
    expect(json.kind).toBe('method');
    expect(json.name).toBe('rev');
    expect(json.args).toEqual([]);
  });

  it('round() produces a method expression', () => {
    const json = s('bd').round().toJSON();
    expect(json.kind).toBe('method');
    expect(json.name).toBe('round');
  });

  it('degrade() produces a method expression', () => {
    const json = s('bd').degrade().toJSON();
    expect(json.kind).toBe('method');
    expect(json.name).toBe('degrade');
  });

  it('degradeBy(0.5) passes the value as arg', () => {
    const json = s('bd').degradeBy(0.5).toJSON();
    expect(json.kind).toBe('method');
    expect(json.name).toBe('degradeBy');
    expect(json.args).toEqual([0.5]);
  });

  it('loop() defaults to true', () => {
    const json = s('bd').loop().toJSON();
    expect(json.args).toEqual([true]);
  });

  it('loop(false) passes false', () => {
    const json = s('bd').loop(false).toJSON();
    expect(json.args).toEqual([false]);
  });

  it('note() without argument passes no args', () => {
    const json = s('bd').note().toJSON();
    expect(json.name).toBe('note');
    expect(json.args).toEqual([]);
  });

  it('note("c4") passes the value', () => {
    const json = s('bd').note('c4').toJSON();
    expect(json.name).toBe('note');
    expect(json.args).toEqual(['c4']);
  });

  it('s() without argument passes no args', () => {
    const result = note('c4').s();
    expect(result.toJSON().name).toBe('s');
    expect(result.toJSON().args).toEqual([]);
  });

  it('attack, decay, sustain, release produce valid nodes', () => {
    const result = s('bd').attack(0.01).decay(0.1).sustain(0.5).release(0.3);
    expect(result.show()).toBe('s("bd").attack(0.01).decay(0.1).sustain(0.5).release(0.3)');
  });

  it('cutoff and hcutoff produce valid nodes', () => {
    expect(s('bd').cutoff(1000).show()).toBe('s("bd").cutoff(1000)');
    expect(s('bd').hcutoff(200).show()).toBe('s("bd").hcutoff(200)');
  });

  it('lpf, hpf, lpq produce valid nodes', () => {
    expect(s('bd').lpf(1000).hpf(200).lpq(5).show()).toBe('s("bd").lpf(1000).hpf(200).lpq(5)');
  });

  it('mask, struct, segment produce valid nodes', () => {
    expect(s('bd').mask('1 0 1 0').show()).toBe('s("bd").mask("1 0 1 0")');
    expect(s('bd').struct('1 0 1 0').show()).toBe('s("bd").struct("1 0 1 0")');
    expect(s('bd').segment(4).show()).toBe('s("bd").segment(4)');
  });

  it('ply, scramble, shuffle produce valid nodes', () => {
    expect(s('bd hh').ply(2).show()).toBe('s("bd hh").ply(2)');
    expect(s('bd hh').scramble(4).show()).toBe('s("bd hh").scramble(4)');
    expect(s('bd hh').shuffle(4).show()).toBe('s("bd hh").shuffle(4)');
  });

  it('compress and zoom produce valid nodes', () => {
    expect(s('bd').compress(0.25, 0.75).show()).toBe('s("bd").compress(0.25, 0.75)');
    expect(s('bd').zoom(0.25, 0.75).show()).toBe('s("bd").zoom(0.25, 0.75)');
  });

  it('early and late produce valid nodes', () => {
    expect(s('bd').early(0.25).show()).toBe('s("bd").early(0.25)');
    expect(s('bd').late(0.25).show()).toBe('s("bd").late(0.25)');
  });

  it('fastGap and slowGap produce valid nodes', () => {
    expect(s('bd').fastGap(2).show()).toBe('s("bd").fastGap(2)');
    expect(s('bd').slowGap(2).show()).toBe('s("bd").slowGap(2)');
  });

  it('set, shape, phaser produce valid nodes', () => {
    expect(s('bd').set({ n: 1 }).show()).toBe('s("bd").set({ n: 1 })');
    expect(s('bd').shape(0.3).show()).toBe('s("bd").shape(0.3)');
    expect(s('bd').phaser(0.5).show()).toBe('s("bd").phaser(0.5)');
  });

  it('fm, bank, anchor, clip, mode, offset produce valid nodes', () => {
    expect(s('bd').fm(2).show()).toBe('s("bd").fm(2)');
    expect(s('bd').bank('drums').show()).toBe('s("bd").bank("drums")');
    expect(s('bd').anchor(0.5).show()).toBe('s("bd").anchor(0.5)');
    expect(s('bd').clip(1).show()).toBe('s("bd").clip(1)');
    expect(s('bd').mode('major').show()).toBe('s("bd").mode("major")');
    expect(s('bd').offset(0.1).show()).toBe('s("bd").offset(0.1)');
  });

  it('add, sub, mul, div produce valid nodes', () => {
    expect(note('0 2').add(12).show()).toBe('note("0 2").add(12)');
    expect(note('0 2').sub(1).show()).toBe('note("0 2").sub(1)');
    expect(note('0 2').mul(2).show()).toBe('note("0 2").mul(2)');
    expect(note('0 2').div(2).show()).toBe('note("0 2").div(2)');
  });

  it('expand, extend, grow, shrink, linger produce valid nodes', () => {
    expect(s('bd').expand(2).show()).toBe('s("bd").expand(2)');
    expect(s('bd').extend(2).show()).toBe('s("bd").extend(2)');
    expect(s('bd').grow(1).show()).toBe('s("bd").grow(1)');
    expect(s('bd').shrink(1).show()).toBe('s("bd").shrink(1)');
    expect(s('bd').linger(0.25).show()).toBe('s("bd").linger(0.25)');
  });

  it('take, drop, tour produce valid nodes', () => {
    expect(s('bd hh').take(1).show()).toBe('s("bd hh").take(1)');
    expect(s('bd hh').drop(1).show()).toBe('s("bd hh").drop(1)');
    expect(s('bd hh').tour('cp', 'sn').show()).toBe('s("bd hh").tour("cp", "sn")');
  });

  it('scale, scaleTranspose, transpose produce valid nodes', () => {
    expect(note('0 2 4').scale('C:major').show()).toBe('note("0 2 4").scale("C:major")');
    expect(note('0 2').scaleTranspose(1).show()).toBe('note("0 2").scaleTranspose(1)');
    expect(note('0 2').transpose(12).show()).toBe('note("0 2").transpose(12)');
  });

  it('voicing, rootNotes, voicings produce valid nodes', () => {
    expect(note('C^7').voicing().show()).toBe('note("C^7").voicing()');
    expect(note('C^7').rootNotes().show()).toBe('note("C^7").rootNotes(2)');
    expect(note('C^7').rootNotes(3).show()).toBe('note("C^7").rootNotes(3)');
    expect(note('C^7').voicings('guidetones').show()).toBe('note("C^7").dict("guidetones").voicing()');
  });
});

// ---------------------------------------------------------------------------
// SignalBuilder
// ---------------------------------------------------------------------------
describe('SignalBuilder', () => {
  it('sine.range(0, 1).fast(2) produces correct expression', () => {
    const result = sine.range(0, 1).fast(2);
    expect(result).toBeInstanceOf(SignalBuilder);
    expect(result.show()).toBe('sine.range(0, 1).fast(2)');
  });

  it('supports add, sub, mul, div', () => {
    expect(sine.add(0.5).show()).toBe('sine.add(0.5)');
    expect(sine.sub(0.1).show()).toBe('sine.sub(0.1)');
    expect(sine.mul(2).show()).toBe('sine.mul(2)');
    expect(sine.div(3).show()).toBe('sine.div(3)');
  });

  it('supports early, late, slow, fast', () => {
    expect(sine.early(0.25).show()).toBe('sine.early(0.25)');
    expect(sine.late(0.25).show()).toBe('sine.late(0.25)');
    expect(sine.slow(2).show()).toBe('sine.slow(2)');
    expect(sine.fast(4).show()).toBe('sine.fast(4)');
  });

  it('supports segment', () => {
    expect(sine.segment(16).show()).toBe('sine.segment(16)');
  });

  it('supports deep chaining', () => {
    const result = sine.range(0, 1).fast(2).slow(3).add(0.1).mul(2);
    expect(result.show()).toBe('sine.range(0, 1).fast(2).slow(3).add(0.1).mul(2)');
  });

  it('toJSON returns the underlying expression node', () => {
    const result = sine.range(0, 1);
    const json = result.toJSON();
    expect(json.kind).toBe('method');
    expect(json.name).toBe('range');
    expect(json.exprType).toBe('signal');
  });
});

// ---------------------------------------------------------------------------
// createParam / createParams
// ---------------------------------------------------------------------------
describe('createParam', () => {
  it('creates a working custom parameter method', () => {
    const myParam = createParam('myCustomParam');
    const result = myParam('hello');
    expect(result).toBeInstanceOf(PatternBuilder);
    expect(result.show()).toBe('myCustomParam("hello")');
  });

  it('registers the method on PatternBuilder so it can be chained', () => {
    createParam('chainableParam');
    const result = s('bd');
    // After createParam, the method should be available via dynamic dispatch
    const fn = (result as unknown as Record<string, (...args: unknown[]) => PatternBuilder>).chainableParam;
    expect(fn).toBeDefined();
    const chained = (fn as (...args: unknown[]) => PatternBuilder).call(result, 'test');
    expect(chained).toBeInstanceOf(PatternBuilder);
    expect(chained.show()).toBe('s("bd").chainableParam("test")');
  });

  it('does not override built-in methods', () => {
    const originalGain = s('bd').gain;
    createParam('gain');
    // Should still be the original method
    expect(s('bd').gain).toBe(originalGain);
  });
});

describe('createParams', () => {
  it('creates multiple custom params at once', () => {
    const params = createParams('foo', 'bar', 'baz');
    expect(typeof params.foo).toBe('function');
    expect(typeof params.bar).toBe('function');
    expect(typeof params.baz).toBe('function');

    expect(params.foo(1).show()).toBe('foo(1)');
    expect(params.bar('x').show()).toBe('bar("x")');
    expect(params.baz(true).show()).toBe('baz(true)');
  });
});

// ---------------------------------------------------------------------------
// normalizeValue via builder behavior
// ---------------------------------------------------------------------------
describe('normalizeValue behavior (tested through builder surface)', () => {
  it('handles primitive values (numbers, strings, booleans, null)', () => {
    expect(s('bd').gain(0.5).toJSON().args).toEqual([0.5]);
    expect(s('bd').bank('drums').toJSON().args).toEqual(['drums']);
    expect(s('bd').loop(true).toJSON().args).toEqual([true]);
  });

  it('handles arrays', () => {
    const result = s('bd').set([1, 2, 3]);
    const json = result.toJSON();
    expect(json.args).toEqual([[1, 2, 3]]);
  });

  it('handles plain objects', () => {
    const result = s('bd').set({ n: 1, gain: 0.5 });
    const json = result.toJSON();
    expect(json.args).toEqual([{ n: 1, gain: 0.5 }]);
  });

  it('handles nested builders by extracting expression nodes', () => {
    const inner = sine.range(0, 1);
    const result = s('bd').gain(inner);
    const json = result.toJSON();
    // The inner builder's expression should be cloned into the args
    expect(json.args.length).toBe(1);
    const gainArg = json.args[0] as { kind: string; name: string };
    expect(gainArg.kind).toBe('method');
    expect(gainArg.name).toBe('range');
  });

  it('handles expression nodes directly', () => {
    const exprNode = sine.toJSON();
    const result = s('bd').gain(exprNode);
    const json = result.toJSON();
    expect(json.args.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Factory functions: stack, cat, seq, silence, note, s
// ---------------------------------------------------------------------------
describe('factory functions', () => {
  it('stack() creates a stack call expression', () => {
    const result = stack(s('bd'), s('hh'));
    expect(result).toBeInstanceOf(PatternBuilder);
    expect(result.show()).toBe('stack(s("bd"), s("hh"))');
    const json = result.toJSON();
    expect(json.kind).toBe('call');
    expect(json.name).toBe('stack');
    expect(json.exprType).toBe('pattern');
  });

  it('cat() creates a cat call expression', () => {
    const result = cat(s('bd'), s('hh'), s('cp'));
    expect(result.show()).toBe('cat(s("bd"), s("hh"), s("cp"))');
  });

  it('seq() creates a seq call expression', () => {
    const result = seq(s('bd'), s('hh'));
    expect(result.show()).toBe('seq(s("bd"), s("hh"))');
  });

  it('silence() creates a silence call expression', () => {
    const result = silence();
    expect(result.show()).toBe('silence()');
    const json = result.toJSON();
    expect(json.kind).toBe('call');
    expect(json.name).toBe('silence');
    expect(json.args).toEqual([]);
  });

  it('note() creates a note call expression', () => {
    const result = note('c4 e4 g4');
    expect(result.show()).toBe('note("c4 e4 g4")');
  });

  it('s() creates a sound source call expression', () => {
    const result = s('bd hh cp');
    expect(result.show()).toBe('s("bd hh cp")');
  });

  it('factory functions accept string, number, and builder arguments', () => {
    expect(stack('bd', 'hh').show()).toBe('stack("bd", "hh")');
    expect(stack(s('bd'), note('c4')).show()).toBe('stack(s("bd"), note("c4"))');
  });
});

// ---------------------------------------------------------------------------
// defineScene
// ---------------------------------------------------------------------------
describe('defineScene', () => {
  it('normalizes channels input', () => {
    const result = defineScene({
      channels: { drums: s('bd').gain(0.5) },
    });
    expect(result.channels.drums).toBeDefined();
    expect(result.channels.drums?.node).toBeDefined();
  });

  it('normalizes root into a channel', () => {
    const result = defineScene({ root: s('bd') });
    expect(Object.keys(result.channels)).toEqual(['main']);
  });

  it('normalizes stack root into multiple channels', () => {
    const result = defineScene({ root: stack(s('bd'), s('hh'), s('cp')) });
    expect(Object.keys(result.channels)).toEqual(['layer1', 'layer2', 'layer3']);
  });

  it('normalizes samples from strings', () => {
    const result = defineScene({
      root: s('bd'),
      samples: ['https://example.com/samples.json'],
    });
    expect(result.samples).toEqual([{ ref: 'https://example.com/samples.json' }]);
  });

  it('normalizes samples from SampleSourceSpec', () => {
    const result = defineScene({
      root: s('bd'),
      samples: [{ ref: 'drums.json' }],
    });
    expect(result.samples).toEqual([{ ref: 'drums.json' }]);
  });

  it('includes transport settings', () => {
    const result = defineScene({
      root: s('bd'),
      transport: { bpm: 120 },
    });
    expect(result.transport.bpm).toBe(120);
  });

  it('throws for null input', () => {
    expect(() => defineScene(null as never)).toThrow(
      'defineScene() expects a scene object with channels or a root expression.',
    );
  });

  it('throws for empty channels with no root', () => {
    expect(() => defineScene({ channels: {} })).toThrow(
      'defineScene() requires at least one channel or a root expression.',
    );
  });

  it('throws for empty scene (no channels, no root)', () => {
    expect(() => defineScene({})).toThrow(
      'defineScene() requires at least one channel or a root expression.',
    );
  });
});

// ---------------------------------------------------------------------------
// SceneRecorder
// ---------------------------------------------------------------------------
describe('SceneRecorder', () => {
  it('beginModule resets state', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.setRoot(s('bd'));
    recorder.setBpm(120);
    const _scene1 = recorder.finalize();

    recorder.beginModule();
    recorder.setRoot(s('hh'));
    const scene2 = recorder.finalize();

    // scene2 should not have bpm from scene1
    expect(scene2.transport.bpm).toBeUndefined();
    expect(Object.keys(scene2.channels).length).toBeGreaterThan(0);
  });

  it('setRoot stores the root expression', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    const input = s('bd');
    const returned = recorder.setRoot(input);
    // setRoot returns the input value
    expect(returned).toBe(input);
    const scene = recorder.finalize();
    expect(Object.keys(scene.channels).length).toBe(1);
  });

  it('finalize produces a valid SceneSpec', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.setRoot(s('bd'));
    const scene = recorder.finalize();
    expect(scene.channels).toBeDefined();
    expect(scene.transport).toBeDefined();
    expect(scene.samples).toBeDefined();
  });

  it('setBpm sets transport.bpm', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.setBpm(140);
    recorder.setRoot(s('bd'));
    const scene = recorder.finalize();
    expect(scene.transport.bpm).toBe(140);
  });

  it('setCps sets transport.cps', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.setCps(0.5);
    recorder.setRoot(s('bd'));
    const scene = recorder.finalize();
    expect(scene.transport.cps).toBe(0.5);
  });

  it('registerSample adds a sample source', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.registerSample('https://example.com/samples.json');
    recorder.setRoot(s('bd'));
    const scene = recorder.finalize();
    expect(scene.samples).toEqual([{ ref: 'https://example.com/samples.json' }]);
  });

  it('registerSample accumulates multiple samples', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.registerSample('pack1.json');
    recorder.registerSample('pack2.json');
    recorder.setRoot(s('bd'));
    const scene = recorder.finalize();
    expect(scene.samples).toEqual([{ ref: 'pack1.json' }, { ref: 'pack2.json' }]);
  });
});

// ---------------------------------------------------------------------------
// SceneRecorder: Hydra
// ---------------------------------------------------------------------------
describe('SceneRecorder Hydra', () => {
  it('initHydra initializes hydra with options', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    const hydra = recorder.initHydra({ detectAudio: true });
    expect(hydra.options).toEqual({ detectAudio: true });
    expect(hydra.programs).toEqual([]);
  });

  it('initHydra merges options with existing hydra state', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.initHydra({ detectAudio: true });
    const hydra = recorder.initHydra({ feedStrudel: 1 });
    expect(hydra.options).toEqual({ detectAudio: true, feedStrudel: 1 });
  });

  it('appendHydraProgram adds a program', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.initHydra();
    const code = recorder.appendHydraProgram('osc(10).out()');
    expect(code).toBe('osc(10).out()');

    recorder.setRoot(s('bd'));
    const scene = recorder.finalize();
    expect(scene.metadata?.hydra).toBeDefined();
    const hydra = scene.metadata?.hydra as { programs: Array<{ code: string }> };
    expect(hydra.programs).toEqual([{ code: 'osc(10).out()' }]);
  });

  it('appendHydraProgram trims whitespace', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    const code = recorder.appendHydraProgram('  osc(10).out()  ');
    expect(code).toBe('osc(10).out()');
  });

  it('appendHydraProgram returns original code for empty/whitespace input', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    const code = recorder.appendHydraProgram('   ');
    expect(code).toBe('   ');
  });

  it('clearHydra removes hydra state', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.initHydra({ detectAudio: true });
    recorder.appendHydraProgram('osc(10).out()');
    recorder.clearHydra();

    recorder.setRoot(s('bd'));
    const scene = recorder.finalize();
    expect(scene.metadata?.hydra).toBeUndefined();
  });

  it('multiple appendHydraProgram calls accumulate programs', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.initHydra();
    recorder.appendHydraProgram('osc(10).out()');
    recorder.appendHydraProgram('shape(3).out(o1)');
    recorder.setRoot(s('bd'));
    const scene = recorder.finalize();
    const hydra = scene.metadata?.hydra as { programs: Array<{ code: string }> };
    expect(hydra.programs).toEqual([{ code: 'osc(10).out()' }, { code: 'shape(3).out(o1)' }]);
  });
});

// ---------------------------------------------------------------------------
// String.prototype extensions
// ---------------------------------------------------------------------------
describe('String.prototype extensions', () => {
  it('install/uninstall/areInstalled lifecycle', () => {
    expect(areStringPrototypeExtensionsInstalled()).toBe(false);

    installStringPrototypeExtensions();
    expect(areStringPrototypeExtensionsInstalled()).toBe(true);

    uninstallStringPrototypeExtensions();
    expect(areStringPrototypeExtensionsInstalled()).toBe(false);
  });

  it('methods work on strings after installation', () => {
    installStringPrototypeExtensions();
    const result = '1 0'.fast(2);
    expect(result).toBeInstanceOf(PatternBuilder);
    expect(result.show()).toBe('value("1 0").fast(2)');
  });

  it('methods are removed after uninstallation', () => {
    installStringPrototypeExtensions();
    expect(typeof ('1 0' as string).fast).toBe('function');

    uninstallStringPrototypeExtensions();
    expect(typeof ('1 0' as string).fast).toBe('undefined');
  });

  it('ref-counting: multiple installs require matching uninstalls', () => {
    installStringPrototypeExtensions();
    installStringPrototypeExtensions();
    expect(areStringPrototypeExtensionsInstalled()).toBe(true);

    uninstallStringPrototypeExtensions();
    expect(areStringPrototypeExtensionsInstalled()).toBe(true);

    uninstallStringPrototypeExtensions();
    expect(areStringPrototypeExtensionsInstalled()).toBe(false);
  });

  it('uninstall with refCount 0 is a no-op', () => {
    expect(areStringPrototypeExtensionsInstalled()).toBe(false);
    uninstallStringPrototypeExtensions(); // should not throw
    expect(areStringPrototypeExtensionsInstalled()).toBe(false);
  });

  it('string chaining produces correct patterns', () => {
    installStringPrototypeExtensions();
    expect('bd hh'.slow(2).fast(4).show()).toBe('value("bd hh").slow(2).fast(4)');
    expect('0 2 4'.add(12).show()).toBe('value("0 2 4").add(12)');
    expect('c4 e4'.transpose(12).show()).toBe('value("c4 e4").transpose(12)');
  });

  it('string sometimes, often, rarely, almostAlways, almostNever work', () => {
    installStringPrototypeExtensions();
    expect('bd'.sometimes((p: PatternBuilder) => p.rev()).show()).toBe(
      'value("bd").sometimesBy(0.5, value("bd").rev())',
    );
    expect('bd'.often((p: PatternBuilder) => p.rev()).show()).toBe(
      'value("bd").sometimesBy(0.75, value("bd").rev())',
    );
  });
});

// ---------------------------------------------------------------------------
// SignalBuilder: extended operations
// ---------------------------------------------------------------------------
describe('SignalBuilder extended operations', () => {
  it('range returns a SignalBuilder with correct expression', () => {
    const result = sine.range(-1, 1);
    expect(result).toBeInstanceOf(SignalBuilder);
    const json = result.toJSON();
    expect(json.kind).toBe('method');
    expect(json.name).toBe('range');
    expect(json.args).toEqual([-1, 1]);
    expect(json.exprType).toBe('signal');
  });

  it('segment quantizes a signal', () => {
    const result = saw.segment(8);
    expect(result).toBeInstanceOf(SignalBuilder);
    expect(result.show()).toBe('saw.segment(8)');
    expect(result.toJSON().name).toBe('segment');
    expect(result.toJSON().args).toEqual([8]);
  });

  it('fast and slow scale signal speed', () => {
    expect(tri.fast(4).show()).toBe('tri.fast(4)');
    expect(tri.slow(0.5).show()).toBe('tri.slow(0.5)');
  });

  it('early and late shift signal phase', () => {
    expect(square.early(0.125).show()).toBe('square.early(0.125)');
    expect(square.late(0.5).show()).toBe('square.late(0.5)');
  });

  it('arithmetic ops chain correctly on signals', () => {
    const result = cosine.add(1).mul(0.5).sub(0.1).div(2);
    expect(result.show()).toBe('cosine().add(1).mul(0.5).sub(0.1).div(2)');
    expect(result).toBeInstanceOf(SignalBuilder);
  });

  it('each chained signal method returns a new SignalBuilder (immutable)', () => {
    const base = sine;
    const withRange = base.range(0, 1);
    const withFast = withRange.fast(2);

    expect(base.show()).toBe('sine');
    expect(withRange.show()).toBe('sine.range(0, 1)');
    expect(withFast.show()).toBe('sine.range(0, 1).fast(2)');
  });

  it('toJSON on a bare signal constant returns a call expression', () => {
    const json = rand.toJSON();
    expect(json.kind).toBe('call');
    expect(json.name).toBe('rand');
    expect(json.exprType).toBe('signal');
  });
});

// ---------------------------------------------------------------------------
// Exported signal constants
// ---------------------------------------------------------------------------
describe('exported signal constants', () => {
  it('sine is a SignalBuilder', () => {
    expect(sine).toBeInstanceOf(SignalBuilder);
    expect(sine.show()).toBe('sine');
    expect(sine.toJSON().name).toBe('sine');
    expect(sine.toJSON().exprType).toBe('signal');
  });

  it('saw is a SignalBuilder', () => {
    expect(saw).toBeInstanceOf(SignalBuilder);
    expect(saw.show()).toBe('saw');
    expect(saw.toJSON().name).toBe('saw');
  });

  it('tri is a SignalBuilder', () => {
    expect(tri).toBeInstanceOf(SignalBuilder);
    expect(tri.show()).toBe('tri');
    expect(tri.toJSON().name).toBe('tri');
  });

  it('triangle is a SignalBuilder', () => {
    expect(triangle).toBeInstanceOf(SignalBuilder);
    expect(triangle.show()).toBe('triangle');
    expect(triangle.toJSON().name).toBe('triangle');
  });

  it('square is a SignalBuilder', () => {
    expect(square).toBeInstanceOf(SignalBuilder);
    expect(square.show()).toBe('square');
    expect(square.toJSON().name).toBe('square');
  });

  it('rand is a SignalBuilder', () => {
    expect(rand).toBeInstanceOf(SignalBuilder);
    expect(rand.show()).toBe('rand');
    expect(rand.toJSON().name).toBe('rand');
  });

  it('perlin is a SignalBuilder', () => {
    expect(perlin).toBeInstanceOf(SignalBuilder);
    expect(perlin.show()).toBe('perlin');
    expect(perlin.toJSON().name).toBe('perlin');
  });

  it('cosine is a SignalBuilder', () => {
    expect(cosine).toBeInstanceOf(SignalBuilder);
    // cosine is not in SIGNAL_IDENTIFIERS so it renders with parens
    expect(cosine.show()).toBe('cosine()');
    expect(cosine.toJSON().name).toBe('cosine');
  });

  it('all signal constants produce "call" kind nodes', () => {
    for (const sig of [sine, saw, tri, triangle, square, rand, perlin, cosine]) {
      expect(sig.toJSON().kind).toBe('call');
      expect(sig.toJSON().exprType).toBe('signal');
    }
  });

  it('signal constants can be used as pattern arguments', () => {
    const result = s('bd').gain(sine.range(0, 1));
    const json = result.toJSON();
    const gainArg = json.args[0] as { kind: string; name: string; exprType: string };
    expect(gainArg.kind).toBe('method');
    expect(gainArg.name).toBe('range');
    expect(gainArg.exprType).toBe('signal');
  });
});

// ---------------------------------------------------------------------------
// createParam / createParams: edge cases
// ---------------------------------------------------------------------------
describe('createParam edge cases', () => {
  it('custom param accepts numeric arguments', () => {
    const freq = createParam('freq');
    expect(freq(440).show()).toBe('freq(440)');
  });

  it('custom param accepts boolean arguments', () => {
    const toggle = createParam('toggle');
    expect(toggle(true).show()).toBe('toggle(true)');
    expect(toggle(false).show()).toBe('toggle(false)');
  });

  it('custom param accepts builder arguments', () => {
    const modParam = createParam('modulation');
    const result = modParam(sine.range(0, 1));
    const json = result.toJSON();
    expect(json.args.length).toBe(1);
    const arg = json.args[0] as { kind: string; name: string };
    expect(arg.kind).toBe('method');
    expect(arg.name).toBe('range');
  });

  it('custom param method is chainable from existing patterns', () => {
    createParam('customEffect');
    const result = s('bd').fast(2);
    const fn = (result as unknown as Record<string, (...args: unknown[]) => PatternBuilder>).customEffect;
    expect(fn).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: fn is verified by toBeDefined above
    const chained = fn!.call(result, 0.7);
    expect(chained.show()).toBe('s("bd").fast(2).customEffect(0.7)');
  });

  it('ignores names with invalid JS identifiers', () => {
    // Names starting with numbers or containing spaces should be silently ignored
    // for prototype registration, but the factory still works
    const fn = createParam('123invalid');
    expect(fn(1).show()).toBe('123invalid(1)');
    // Should not be registered on prototype (since the name is invalid)
    expect('123invalid' in PatternBuilder.prototype).toBe(false);
  });

  it('does not override existing built-in methods when called multiple times', () => {
    const firstFn = createParam('uniqueParam1');
    const secondFn = createParam('uniqueParam1');
    // Both factory functions work
    expect(firstFn(1).show()).toBe('uniqueParam1(1)');
    expect(secondFn(2).show()).toBe('uniqueParam1(2)');
  });
});

describe('createParams edge cases', () => {
  it('returns an empty object for no arguments', () => {
    const params = createParams();
    expect(Object.keys(params)).toEqual([]);
  });

  it('each returned function is independent', () => {
    const params = createParams('alpha', 'beta');
    const a = params.alpha(10);
    const b = params.beta(20);
    expect(a.show()).toBe('alpha(10)');
    expect(b.show()).toBe('beta(20)');
    // They produce independent expression trees
    expect(a.toJSON().name).toBe('alpha');
    expect(b.toJSON().name).toBe('beta');
  });

  it('params can be chained onto patterns', () => {
    const _params = createParams('x', 'y');
    const result = s('bd');
    const xFn = (result as unknown as Record<string, (...args: unknown[]) => PatternBuilder>).x;
    const yFn = (result as unknown as Record<string, (...args: unknown[]) => PatternBuilder>).y;
    expect(xFn).toBeDefined();
    expect(yFn).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: verified above
    const chained = yFn!.call(xFn!.call(result, 1), 2);
    expect(chained.show()).toBe('s("bd").x(1).y(2)');
  });
});

// ---------------------------------------------------------------------------
// SceneRecorder: state management
// ---------------------------------------------------------------------------
describe('SceneRecorder state management', () => {
  it('beginModule fully resets transport, samples, and root between calls', () => {
    const recorder = new SceneRecorder();

    recorder.beginModule();
    recorder.setBpm(100);
    recorder.registerSample('pack.json');
    recorder.setRoot(s('bd'));
    const scene1 = recorder.finalize();

    recorder.beginModule();
    recorder.setRoot(s('hh'));
    const scene2 = recorder.finalize();

    // scene1 should have bpm and samples
    expect(scene1.transport.bpm).toBe(100);
    expect(scene1.samples).toEqual([{ ref: 'pack.json' }]);

    // scene2 should have clean state
    expect(scene2.transport.bpm).toBeUndefined();
    expect(scene2.transport.cps).toBeUndefined();
    expect(scene2.samples).toEqual([]);
  });

  it('setRoot returns the original input value for pass-through', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    const input = s('bd').fast(2);
    const returned = recorder.setRoot(input);
    expect(returned).toBe(input);
  });

  it('setRoot can be called multiple times and last one wins', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.setRoot(s('bd'));
    recorder.setRoot(s('hh'));
    recorder.setRoot(s('cp'));
    const scene = recorder.finalize();
    const channelNode = scene.channels.main?.node;
    expect(channelNode).toBeDefined();
    // The last root (cp) should be the one used
    expect((channelNode as { name: string }).name).toBe('s');
    expect((channelNode as { args: unknown[] }).args).toEqual(['cp']);
  });

  it('setBpm and setCps are independent transport properties', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.setBpm(120);
    recorder.setCps(2);
    recorder.setRoot(s('bd'));
    const scene = recorder.finalize();
    expect(scene.transport.bpm).toBe(120);
    expect(scene.transport.cps).toBe(2);
  });

  it('setMetadata merges with existing metadata', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule({ author: 'test' } as unknown as import('@tussel/ir').MetadataSpec);
    recorder.setMetadata({ version: '1.0' } as unknown as import('@tussel/ir').MetadataSpec);
    recorder.setRoot(s('bd'));
    const scene = recorder.finalize();
    expect((scene.metadata as Record<string, unknown>)?.author).toBe('test');
    expect((scene.metadata as Record<string, unknown>)?.version).toBe('1.0');
  });

  it('finalize without setRoot throws because scene has no channels', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    expect(() => recorder.finalize()).toThrow();
  });

  it('registerSample preserves insertion order', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.registerSample('z.json');
    recorder.registerSample('a.json');
    recorder.registerSample('m.json');
    recorder.setRoot(s('bd'));
    const scene = recorder.finalize();
    expect(scene.samples).toEqual([{ ref: 'z.json' }, { ref: 'a.json' }, { ref: 'm.json' }]);
  });
});

// ---------------------------------------------------------------------------
// String prototype extensions: detailed behavior
// ---------------------------------------------------------------------------
describe('String prototype extensions: detailed behavior', () => {
  it('all STRING_PATTERN_METHODS are installed', () => {
    installStringPrototypeExtensions();

    const expectedMethods = [
      'add',
      'almostAlways',
      'almostNever',
      'compress',
      'contract',
      'degrade',
      'degradeBy',
      'div',
      'drop',
      'edo',
      'every',
      'early',
      'expand',
      'extend',
      'fast',
      'fastGap',
      'grow',
      'hurry',
      'jux',
      'juxBy',
      'late',
      'layer',
      'linger',
      'log',
      'loop',
      'midichan',
      'midicc',
      'midiport',
      'midivalue',
      'mul',
      'off',
      'often',
      'osc',
      'oschost',
      'oscport',
      'pace',
      'ply',
      'rarely',
      'rev',
      'rootNotes',
      'scramble',
      'scale',
      'scaleTranspose',
      'shuffle',
      'shrink',
      'slow',
      'slowGap',
      'sometimes',
      'sometimesBy',
      'sub',
      'superimpose',
      'take',
      'tour',
      'transpose',
      'velocity',
      'voicings',
      'when',
      'within',
      'zoom',
    ];

    for (const method of expectedMethods) {
      expect(typeof ('' as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });

  it('all methods are removed after uninstallation', () => {
    installStringPrototypeExtensions();
    uninstallStringPrototypeExtensions();

    const sampleMethods = ['fast', 'slow', 'add', 'rev', 'gain'];
    for (const method of sampleMethods) {
      expect(typeof ('' as unknown as Record<string, unknown>)[method]).toBe('undefined');
    }
  });

  it('triple install requires triple uninstall', () => {
    installStringPrototypeExtensions();
    installStringPrototypeExtensions();
    installStringPrototypeExtensions();

    uninstallStringPrototypeExtensions();
    expect(areStringPrototypeExtensionsInstalled()).toBe(true);

    uninstallStringPrototypeExtensions();
    expect(areStringPrototypeExtensionsInstalled()).toBe(true);

    uninstallStringPrototypeExtensions();
    expect(areStringPrototypeExtensionsInstalled()).toBe(false);
  });

  it('string methods delegate to value() builder correctly', () => {
    installStringPrototypeExtensions();
    const result = 'c4 e4 g4'.transpose(12);
    expect(result).toBeInstanceOf(PatternBuilder);
    expect(result.show()).toBe('value("c4 e4 g4").transpose(12)');
  });

  it('string rev() returns a PatternBuilder', () => {
    installStringPrototypeExtensions();
    const result = 'bd hh'.rev();
    expect(result).toBeInstanceOf(PatternBuilder);
    expect(result.show()).toBe('value("bd hh").rev()');
  });

  it('does not overwrite existing String.prototype methods', () => {
    // Methods like toString, valueOf, etc. should not be affected
    const str = 'hello';
    installStringPrototypeExtensions();
    expect(str.toString()).toBe('hello');
    expect(str.valueOf()).toBe('hello');
    expect(str.toUpperCase()).toBe('HELLO');
  });
});

// ---------------------------------------------------------------------------
// normalizeValue: complex nesting
// ---------------------------------------------------------------------------
describe('normalizeValue with complex nesting', () => {
  it('handles nested arrays of builders', () => {
    const result = s('bd').set([sine.range(0, 1), 42, 'hello']);
    const json = result.toJSON();
    const setArg = json.args[0] as unknown[];
    expect(Array.isArray(setArg)).toBe(true);
    expect(setArg.length).toBe(3);
    // First element is the normalized sine.range expression
    expect((setArg[0] as { kind: string }).kind).toBe('method');
    expect(setArg[1]).toBe(42);
    expect(setArg[2]).toBe('hello');
  });

  it('handles objects with builder values', () => {
    const result = s('bd').set({ gain: sine.range(0, 1), n: 3 });
    const json = result.toJSON();
    const setArg = json.args[0] as Record<string, unknown>;
    expect((setArg.gain as { kind: string }).kind).toBe('method');
    expect(setArg.n).toBe(3);
  });

  it('handles deeply nested structures', () => {
    const inner = sine.range(0, 1);
    const result = s('bd').set({ effects: [{ mod: inner, level: 0.5 }] });
    const json = result.toJSON();
    const setArg = json.args[0] as Record<string, unknown>;
    const effects = setArg.effects as unknown[];
    expect(Array.isArray(effects)).toBe(true);
    const first = effects[0] as Record<string, unknown>;
    expect((first.mod as { kind: string }).kind).toBe('method');
    expect(first.level).toBe(0.5);
  });

  it('handles null values in args', () => {
    // null is a valid ExpressionValue primitive
    const result = s('bd').set(null);
    const json = result.toJSON();
    expect(json.args).toEqual([null]);
  });

  it('handles boolean values in args', () => {
    const result = s('bd').loop(true);
    expect(result.toJSON().args).toEqual([true]);
    const result2 = s('bd').loop(false);
    expect(result2.toJSON().args).toEqual([false]);
  });

  it('clones expression nodes so mutations do not propagate', () => {
    const inner = sine.range(0, 1);
    const r1 = s('bd').gain(inner);
    const r2 = s('hh').gain(inner);
    // Both should have independent copies
    const arg1 = r1.toJSON().args[0] as { name: string };
    const arg2 = r2.toJSON().args[0] as { name: string };
    expect(arg1.name).toBe('range');
    expect(arg2.name).toBe('range');
    // They should be structurally equal but not the same reference
    expect(arg1).not.toBe(arg2);
  });

  it('normalizeValue throws for unsupported types like functions', () => {
    expect(() => {
      s('bd').set((() => {}) as unknown);
    }).toThrow('Unsupported structural value');
  });

  it('normalizeValue throws for unsupported types like symbols', () => {
    expect(() => {
      s('bd').set(Symbol('test') as unknown);
    }).toThrow('Unsupported structural value');
  });
});
