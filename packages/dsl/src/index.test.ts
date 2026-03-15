import {
  __tusselRecorder,
  add,
  areStringPrototypeExtensionsInstalled,
  cc,
  clearHydra,
  compress,
  contract,
  cosine,
  createParam,
  createParams,
  csound,
  csoundm,
  defineScene,
  early,
  expand,
  fastGap,
  gamepad,
  grow,
  H,
  hurry,
  hydra,
  initHydra,
  input,
  installStringPrototypeExtensions,
  linger,
  midi,
  motion,
  note,
  PatternBuilder,
  pace,
  perlin,
  rand,
  rev,
  SceneRecorder,
  SignalBuilder,
  s,
  saw,
  scene,
  scramble,
  setcpm,
  setcps,
  setInputValue,
  shrink,
  shuffle,
  silence,
  sine,
  slow,
  slowGap,
  sound,
  square,
  stack,
  stepcat,
  tri,
  triangle,
  uninstallStringPrototypeExtensions,
  value,
  zip,
  zoom,
} from '@tussel/dsl';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  while (areStringPrototypeExtensionsInstalled()) {
    uninstallStringPrototypeExtensions();
  }
});

describe('defineScene', () => {
  it('normalizes a stack root into channels', () => {
    const normalized = defineScene({
      root: stack(s('bd'), s('hh')),
    });

    expect(Object.keys(normalized.channels)).toEqual(['layer1', 'layer2']);
  });

  it('keeps explicit scene fragments from script roots', () => {
    const normalized = defineScene(
      scene({
        master: { gain: 0.4 },
        channels: {
          drums: s('bd').gain(0.4),
        },
      }),
    );

    expect(normalized.master?.gain).toBe(0.4);
    expect(normalized.channels.drums).toBeDefined();
  });

  it('records transport and root in script mode', () => {
    __tusselRecorder.beginModule();
    setcps(0.75);
    __tusselRecorder.setRoot(stack(s('bd')));
    const normalized = __tusselRecorder.finalize();

    expect(normalized.transport.cps).toBe(0.75);
    expect(Object.keys(normalized.channels)).toEqual(['layer1']);
  });

  it('converts setcpm into cycles-per-second in script mode', () => {
    __tusselRecorder.beginModule();
    setcpm(120);
    __tusselRecorder.setRoot(stack(s('bd')));
    const normalized = __tusselRecorder.finalize();

    expect(normalized.transport.cps).toBe(2);
  });

  it('supports string timing transforms for Strudel-like authoring', () => {
    installStringPrototypeExtensions();
    const shifted = '1 0'.fast(2).early(0.25);
    expect(shifted.show()).toBe('value("1 0").fast(2).early(0.25)');
  });

  it('logs pattern builders and string helpers without breaking chaining', () => {
    installStringPrototypeExtensions();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const pattern = s('bd').fast(2).log().slow(2);
    const shifted = '1 0'.log().fast(2);

    expect(pattern.show()).toBe('s("bd").fast(2).slow(2)');
    expect(shifted.show()).toBe('value("1 0").fast(2)');
    expect(logSpy).toHaveBeenCalledWith('s("bd").fast(2)');
    expect(logSpy).toHaveBeenCalledWith('1 0');
    logSpy.mockRestore();
  });

  it('preserves layered channels when stack roots have outer transforms', () => {
    const normalized = defineScene({
      root: stack(s('bd'), s('hh')).late(0.02).size(4),
    });

    expect(Object.keys(normalized.channels)).toEqual(['layer1', 'layer2']);
    expect(normalized.channels.layer1?.node).toMatchObject({ kind: 'method', name: 'size' });
  });

  it('rejects invalid or empty scene inputs with actionable errors', () => {
    expect(() => defineScene(null as never)).toThrow(
      'defineScene() expects a scene object with channels or a root expression.',
    );
    expect(() => defineScene({ channels: {} })).toThrow(
      'defineScene() requires at least one channel or a root expression. Received an empty scene.',
    );
  });

  it('exposes note, sound, and silence aliases', () => {
    expect(note('0 2 4').show()).toBe('note("0 2 4")');
    expect(sound('bd hh').show()).toBe('sound("bd hh")');
    expect(silence().show()).toBe('silence()');
  });

  it('exposes csound helpers on builders and top-level functions', () => {
    expect(note('c4').csound('FM1').show()).toBe('note("c4").csound("FM1")');
    expect(note('c4').csoundm('CoolSynth').show()).toBe('note("c4").csoundm("CoolSynth")');
    expect(csound('FM1', note('c4')).show()).toBe('note("c4").csound("FM1")');
    expect(csoundm('CoolSynth', note('c4')).show()).toBe('note("c4").csoundm("CoolSynth")');
  });

  it('records hydra configuration and programs in scene metadata', () => {
    __tusselRecorder.beginModule();
    initHydra({ detectAudio: true, feedStrudel: 1 });
    hydra`osc(10).out()`;
    __tusselRecorder.setRoot(note('c4'));
    const normalized = __tusselRecorder.finalize();

    expect(normalized.metadata?.hydra).toEqual({
      options: { detectAudio: true, feedStrudel: 1 },
      programs: [{ code: 'osc(10).out()' }],
    });

    clearHydra();
  });

  it('exposes input and hydra helpers on the DSL surface', () => {
    setInputValue('knob:1', 0.5);

    expect(input('knob:1').range(0, 1).show()).toBe('input("knob:1").range(0, 1)');
    expect(midi(74).range(0, 127).show()).toBe('midi(74).range(0, 127)');
    expect(cc(1, 'controller').show()).toBe('cc(1, "controller")');
    expect(gamepad('axis:0', 1).show()).toBe('gamepad("axis:0", 1)');
    expect(motion('x').show()).toBe('motion("x")');
    expect(H('3 4 5')).toBe('H("3 4 5")');
  });

  it('keeps begin and end controls structural for sample playback', () => {
    expect(s('bd').begin(0.25).end(0.75).show()).toBe('s("bd").begin(0.25).end(0.75)');
  });

  it('lowers accumulation helpers into structural patterns', () => {
    expect(
      s('bd')
        .superimpose((pattern: PatternBuilder) => pattern.fast(2))
        .show(),
    ).toBe('stack(s("bd"), s("bd").fast(2))');
    expect(
      s('bd')
        .off(0.25, (pattern: PatternBuilder) => pattern.rev())
        .show(),
    ).toBe('stack(s("bd"), s("bd").rev().late(0.25))');
    expect(
      s('bd')
        .juxBy(0.5, (pattern: PatternBuilder) => pattern.rev())
        .show(),
    ).toBe('stack(s("bd").pan(-0.5), s("bd").rev().pan(0.5))');
  });

  it('supports callback-based conditional helpers in the DSL surface', () => {
    installStringPrototypeExtensions();
    expect(
      note('0 1')
        .every(2, (pattern: PatternBuilder) => pattern.add(12))
        .show(),
    ).toBe('note("0 1").every(2, note("0 1").add(12))');
    expect('0 1'.sometimes((pattern: PatternBuilder) => pattern.rev()).show()).toBe(
      'value("0 1").sometimesBy(0.5, value("0 1").rev())',
    );
    expect('0 1'.rarely((pattern: PatternBuilder) => pattern.rev()).show()).toBe(
      'value("0 1").sometimesBy(0.25, value("0 1").rev())',
    );
  });

  it('accepts top-level transform helpers inside structural modifiers', () => {
    installStringPrototypeExtensions();
    expect(s('bd').jux(rev).show()).toBe('stack(s("bd").pan(-1), s("bd").rev().pan(1))');
    expect(note('0 1').off(0.125, add(7)).show()).toBe('stack(note("0 1"), note("0 1").add(7).late(0.125))');
    expect('0 1'.sometimes(slow(2)).show()).toBe('value("0 1").sometimesBy(0.5, value("0 1").slow(2))');
    expect(note('0 1').every(2, early(0.25)).show()).toBe('note("0 1").every(2, note("0 1").early(0.25))');
  });

  it('exposes time and random helper transforms as structural modifiers', () => {
    expect(note('0 1').every(2, hurry(2)).show()).toBe('note("0 1").every(2, note("0 1").hurry(2))');
    expect(note('0 1').every(2, linger(0.25)).show()).toBe('note("0 1").every(2, note("0 1").linger(0.25))');
    expect(note('0 1').every(2, fastGap(2)).show()).toBe('note("0 1").every(2, note("0 1").fastGap(2))');
    expect(note('0 1').every(2, compress(0.25, 0.75)).show()).toBe(
      'note("0 1").every(2, note("0 1").compress(0.25, 0.75))',
    );
    expect(note('0 1').every(2, zoom(0.25, 0.75)).show()).toBe(
      'note("0 1").every(2, note("0 1").zoom(0.25, 0.75))',
    );
    expect(note('0 1').every(2, shuffle(4)).show()).toBe('note("0 1").every(2, note("0 1").shuffle(4))');
    expect(note('0 1').every(2, scramble(4)).show()).toBe('note("0 1").every(2, note("0 1").scramble(4))');
    expect(note('0 1').every(2, slowGap(2)).show()).toBe('note("0 1").every(2, note("0 1").slowGap(2))');
  });

  it('exposes tonal helpers on builders and strings', () => {
    installStringPrototypeExtensions();
    expect(value('0 2 4').scale('C:major').scaleTranspose(1).note().show()).toBe(
      'value("0 2 4").scale("C:major").scaleTranspose(1).note()',
    );
    expect('C^7 A7'.rootNotes(2).show()).toBe('value("C^7 A7").rootNotes(2)');
    expect('C^7'.voicings('guidetones').show()).toBe('value("C^7").dict("guidetones").voicing()');
    expect(note('C4 E4').transpose(12).show()).toBe('note("C4 E4").transpose(12)');
  });

  it('exposes stepwise helpers on builders, strings, and calls', () => {
    installStringPrototypeExtensions();
    expect(stepcat('bd hh hh', 'bd hh hh cp hh').show()).toBe('stepcat("bd hh hh", "bd hh hh cp hh")');
    expect('c a f e'.expand(2).pace(8).show()).toBe('value("c a f e").expand(2).pace(8)');
    expect(note('0 1 2 3').every(2, expand(2)).show()).toBe(
      'note("0 1 2 3").every(2, note("0 1 2 3").expand(2))',
    );
    expect(note('0 1 2 3').every(2, pace(8)).show()).toBe(
      'note("0 1 2 3").every(2, note("0 1 2 3").pace(8))',
    );
    expect(note('0 1 2 3').every(2, contract(2)).show()).toBe(
      'note("0 1 2 3").every(2, note("0 1 2 3").contract(2))',
    );
    expect('0 1 2 3'.shrink(1).show()).toBe('value("0 1 2 3").shrink(1)');
    expect('0 1 2 3'.grow(-1).show()).toBe('value("0 1 2 3").grow(-1)');
    expect('c g'.tour('e f', 'g a').show()).toBe('value("c g").tour("e f", "g a")');
    expect(zip('a b', 'c d e').show()).toBe('zip("a b", "c d e")');
    expect(note('0 1').every(2, shrink(1)).show()).toBe('note("0 1").every(2, note("0 1").shrink(1))');
    expect(note('0 1').every(2, grow(1)).show()).toBe('note("0 1").every(2, note("0 1").grow(1))');
  });

  it('installs string helpers explicitly instead of patching on import', () => {
    expect(areStringPrototypeExtensionsInstalled()).toBe(false);
    expect(typeof ('1 0' as string).fast).toBe('undefined');

    installStringPrototypeExtensions();

    expect(areStringPrototypeExtensionsInstalled()).toBe(true);
    expect('1 0'.fast(2).show()).toBe('value("1 0").fast(2)');

    uninstallStringPrototypeExtensions();

    expect(areStringPrototypeExtensionsInstalled()).toBe(false);
    expect(typeof ('1 0' as string).fast).toBe('undefined');
  });

  it('exposes MIDI and OSC output annotations on patterns', () => {
    expect(note('c4').midiport('loop').midichan(2).velocity(0.5).show()).toBe(
      'note("c4").midiport("loop").midichan(2).velocity(0.5)',
    );
    expect(value(0.25).midicc(74).midivalue(64).midiport('loop').show()).toBe(
      'value(0.25).midicc(74).midivalue(64).midiport("loop")',
    );
    expect(s('bd').osc('/drums/kick').oschost('127.0.0.1').oscport(57120).show()).toBe(
      's("bd").osc("/drums/kick").oschost("127.0.0.1").oscport(57120)',
    );
  });
});

// ---------------------------------------------------------------------------
// G.01: Deep PatternBuilder chaining
// ---------------------------------------------------------------------------
describe('G.01 — deep PatternBuilder chaining', () => {
  it('chains 10+ methods and produces correct .show() output', () => {
    const result = note('0')
      .fast(2)
      .slow(3)
      .rev()
      .add(1)
      .gain(0.5)
      .pan(0.2)
      .speed(1.5)
      .delay(0.3)
      .room(0.4)
      .cut(1)
      .orbit(2);
    expect(result).toBeInstanceOf(PatternBuilder);
    expect(result.show()).toBe(
      'note("0").fast(2).slow(3).rev().add(1).gain(0.5).pan(0.2).speed(1.5).delay(0.3).room(0.4).cut(1).orbit(2)',
    );
  });

  it('deep chain produces a valid expression tree with correct nesting', () => {
    const result = note('0').fast(2).slow(3).rev().add(1).gain(0.5);
    const json = result.toJSON();
    // The outermost method should be gain
    expect(json.kind).toBe('method');
    expect(json.name).toBe('gain');
    expect(json.exprType).toBe('pattern');
    // Walk down: gain -> add -> rev -> slow -> fast -> note
    type MethodNode = { kind: string; name: string; target: MethodNode };
    const addNode = (json as unknown as MethodNode).target;
    expect(addNode.name).toBe('add');
    const revNode = addNode.target;
    expect(revNode.name).toBe('rev');
    const slowNode = revNode.target;
    expect(slowNode.name).toBe('slow');
    const fastNode = slowNode.target;
    expect(fastNode.name).toBe('fast');
    const noteNode = fastNode.target;
    expect(noteNode.kind).toBe('call');
    expect(noteNode.name).toBe('note');
  });

  it('branching from an intermediate node does not mutate the original chain', () => {
    const base = s('bd').fast(2).gain(0.5);
    const branchA = base.slow(3);
    const branchB = base.rev();
    expect(base.show()).toBe('s("bd").fast(2).gain(0.5)');
    expect(branchA.show()).toBe('s("bd").fast(2).gain(0.5).slow(3)');
    expect(branchB.show()).toBe('s("bd").fast(2).gain(0.5).rev()');
  });

  it('mixing effect, timing, and tonal methods in a single chain', () => {
    const result = note('c4 e4 g4')
      .scale('C:major')
      .scaleTranspose(2)
      .fast(4)
      .gain(sine)
      .room(0.3)
      .delay(0.2)
      .pan(cosine)
      .velocity(0.8);
    expect(result.show()).toBe(
      'note("c4 e4 g4").scale("C:major").scaleTranspose(2).fast(4).gain(sine).room(0.3).delay(0.2).pan(cosine()).velocity(0.8)',
    );
  });
});

// ---------------------------------------------------------------------------
// G.02: SignalBuilder operations
// ---------------------------------------------------------------------------
describe('G.02 — SignalBuilder operations', () => {
  it('sine.range(0, 1).fast(2).add(0.5) produces correct expression', () => {
    const result = sine.range(0, 1).fast(2).add(0.5);
    expect(result).toBeInstanceOf(SignalBuilder);
    expect(result.show()).toBe('sine.range(0, 1).fast(2).add(0.5)');
  });

  it('signal arithmetic chains correctly', () => {
    const result = saw.range(-1, 1).mul(0.5).add(0.25).div(2).sub(0.1);
    expect(result).toBeInstanceOf(SignalBuilder);
    expect(result.show()).toBe('saw.range(-1, 1).mul(0.5).add(0.25).div(2).sub(0.1)');
  });

  it('signal timing methods chain correctly', () => {
    const result = triangle.fast(4).slow(2).early(0.125).late(0.25);
    expect(result).toBeInstanceOf(SignalBuilder);
    expect(result.show()).toBe('triangle.fast(4).slow(2).early(0.125).late(0.25)');
  });

  it('signal can be used as a pattern argument through deep chaining', () => {
    const mod = sine.range(0, 1).fast(4).add(0.1);
    const result = s('bd').gain(mod);
    const json = result.toJSON();
    const gainArg = json.args[0] as { kind: string; name: string; exprType: string };
    expect(gainArg.kind).toBe('method');
    expect(gainArg.name).toBe('add');
    expect(gainArg.exprType).toBe('signal');
  });

  it('segment quantizes a signal and chains further', () => {
    const result = perlin.segment(16).range(0, 1).mul(0.8);
    expect(result.show()).toBe('perlin.segment(16).range(0, 1).mul(0.8)');
  });
});

// ---------------------------------------------------------------------------
// G.03: createParam / createParams
// ---------------------------------------------------------------------------
describe('G.03 — createParam and createParams', () => {
  it('createParam creates a top-level factory and registers it as chainable', () => {
    const wobble = createParam('wobbleG03');
    const topLevel = wobble(0.5);
    expect(topLevel).toBeInstanceOf(PatternBuilder);
    expect(topLevel.show()).toBe('wobbleG03(0.5)');

    // Also chainable on existing patterns
    const chained = s('bd') as unknown as Record<
      string,
      ((...args: unknown[]) => PatternBuilder) | undefined
    >;
    const result = chained.wobbleG03?.(0.8);
    expect(result).toBeDefined();
    expect(result!.show()).toBe('s("bd").wobbleG03(0.8)');
  });

  it('createParams creates multiple independent param factories', () => {
    const { attack03: atk, release03: rel } = createParams('attack03', 'release03');
    expect(atk(0.01).show()).toBe('attack03(0.01)');
    expect(rel(0.5).show()).toBe('release03(0.5)');
    // Each factory is independent
    expect(atk(0.01).toJSON().name).toBe('attack03');
    expect(rel(0.5).toJSON().name).toBe('release03');
  });

  it('createParam accepts builder arguments', () => {
    const depth = createParam('depthG03');
    const result = depth(sine.range(0, 1));
    const json = result.toJSON();
    expect(json.args.length).toBe(1);
    const arg = json.args[0] as { kind: string; name: string };
    expect(arg.kind).toBe('method');
    expect(arg.name).toBe('range');
  });

  it('createParam ignores invalid JS identifiers for prototype registration', () => {
    const fn = createParam('0startsBad');
    expect(fn(1).show()).toBe('0startsBad(1)');
    expect('0startsBad' in PatternBuilder.prototype).toBe(false);
  });

  it('createParam does not override built-in PatternBuilder methods', () => {
    const originalFast = s('bd').fast;
    createParam('fast');
    expect(s('bd').fast).toBe(originalFast);
  });

  it('createParams with no arguments returns an empty object', () => {
    const result = createParams();
    expect(Object.keys(result)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// G.04: SceneRecorder state management
// ---------------------------------------------------------------------------
describe('G.04 — SceneRecorder state management', () => {
  it('beginModule resets all state between calls', () => {
    const recorder = new SceneRecorder();

    recorder.beginModule();
    recorder.setBpm(140);
    recorder.setCps(2);
    recorder.registerSample('pack1.json');
    recorder.setRoot(s('bd'));
    const scene1 = recorder.finalize();

    recorder.beginModule();
    recorder.setRoot(s('hh'));
    const scene2 = recorder.finalize();

    expect(scene1.transport.bpm).toBe(140);
    expect(scene1.transport.cps).toBe(2);
    expect(scene1.samples).toEqual([{ ref: 'pack1.json' }]);

    expect(scene2.transport.bpm).toBeUndefined();
    expect(scene2.transport.cps).toBeUndefined();
    expect(scene2.samples).toEqual([]);
  });

  it('finalize produces a valid SceneSpec with channels, transport, and samples', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.setCps(1);
    recorder.registerSample('drums.json');
    recorder.setRoot(stack(s('bd'), s('hh')));
    const scene = recorder.finalize();

    expect(scene.channels).toBeDefined();
    expect(Object.keys(scene.channels)).toEqual(['layer1', 'layer2']);
    expect(scene.transport.cps).toBe(1);
    expect(scene.samples).toEqual([{ ref: 'drums.json' }]);
  });

  it('setBpm and setCps are independent properties on transport', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.setBpm(120);
    recorder.setCps(2);
    recorder.setRoot(s('bd'));
    const scene = recorder.finalize();
    expect(scene.transport.bpm).toBe(120);
    expect(scene.transport.cps).toBe(2);
  });

  it('setRoot can be called multiple times; last one wins', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    recorder.setRoot(s('bd'));
    recorder.setRoot(s('hh'));
    recorder.setRoot(note('c4'));
    const scene = recorder.finalize();
    const channelNode = scene.channels.main?.node as { name: string; args: unknown[] };
    expect(channelNode.name).toBe('note');
    expect(channelNode.args).toEqual(['c4']);
  });

  it('setRoot returns the original input for pass-through chaining', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    const input = s('bd').fast(2);
    const returned = recorder.setRoot(input);
    expect(returned).toBe(input);
  });

  it('finalize without setRoot throws because scene has no channels', () => {
    const recorder = new SceneRecorder();
    recorder.beginModule();
    expect(() => recorder.finalize()).toThrow();
  });

  it('global __tusselRecorder works with setcps and setcpm', () => {
    __tusselRecorder.beginModule();
    setcps(0.5);
    __tusselRecorder.setRoot(s('bd'));
    const scene1 = __tusselRecorder.finalize();
    expect(scene1.transport.cps).toBe(0.5);

    __tusselRecorder.beginModule();
    setcpm(90);
    __tusselRecorder.setRoot(s('bd'));
    const scene2 = __tusselRecorder.finalize();
    expect(scene2.transport.cps).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// G.05: String prototype extensions
// ---------------------------------------------------------------------------
describe('G.05 — string prototype extensions', () => {
  it('install adds pattern methods to String.prototype', () => {
    expect(areStringPrototypeExtensionsInstalled()).toBe(false);
    installStringPrototypeExtensions();
    expect(areStringPrototypeExtensionsInstalled()).toBe(true);

    const sampleMethods = ['fast', 'slow', 'add', 'rev', 'early', 'late', 'every', 'shuffle'];
    for (const method of sampleMethods) {
      expect(typeof ('' as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });

  it('uninstall removes all methods from String.prototype', () => {
    installStringPrototypeExtensions();
    uninstallStringPrototypeExtensions();
    expect(areStringPrototypeExtensionsInstalled()).toBe(false);

    const sampleMethods = ['fast', 'slow', 'add', 'rev', 'early', 'late'];
    for (const method of sampleMethods) {
      expect(typeof ('' as unknown as Record<string, unknown>)[method]).toBe('undefined');
    }
  });

  it('string methods produce PatternBuilder instances via value() wrapping', () => {
    installStringPrototypeExtensions();
    const result = 'c4 e4 g4'.fast(2).slow(3);
    expect(result).toBeInstanceOf(PatternBuilder);
    expect(result.show()).toBe('value("c4 e4 g4").fast(2).slow(3)');
  });

  it('ref-counting requires matching installs and uninstalls', () => {
    installStringPrototypeExtensions();
    installStringPrototypeExtensions();
    installStringPrototypeExtensions();

    uninstallStringPrototypeExtensions();
    expect(areStringPrototypeExtensionsInstalled()).toBe(true);
    uninstallStringPrototypeExtensions();
    expect(areStringPrototypeExtensionsInstalled()).toBe(true);
    uninstallStringPrototypeExtensions();
    expect(areStringPrototypeExtensionsInstalled()).toBe(false);
    expect(typeof ('x' as unknown as Record<string, unknown>).fast).toBe('undefined');
  });

  it('does not overwrite native String.prototype methods', () => {
    installStringPrototypeExtensions();
    expect('hello'.toString()).toBe('hello');
    expect('HELLO'.toLowerCase()).toBe('hello');
    expect('hello'.valueOf()).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// G.06: normalizeValue with complex nesting
// ---------------------------------------------------------------------------
describe('G.06 — normalizeValue with complex nesting', () => {
  it('normalizes arrays containing mixed builders and primitives', () => {
    const result = s('bd').set([sine.range(0, 1), 42, 'hello', null, true]);
    const json = result.toJSON();
    const setArg = json.args[0] as unknown[];
    expect(Array.isArray(setArg)).toBe(true);
    expect(setArg.length).toBe(5);
    expect((setArg[0] as { kind: string }).kind).toBe('method');
    expect(setArg[1]).toBe(42);
    expect(setArg[2]).toBe('hello');
    expect(setArg[3]).toBeNull();
    expect(setArg[4]).toBe(true);
  });

  it('normalizes nested objects with builder values', () => {
    const result = s('bd').set({ gain: sine.range(0, 1), n: 3, active: true });
    const json = result.toJSON();
    const setArg = json.args[0] as Record<string, unknown>;
    expect((setArg.gain as { kind: string }).kind).toBe('method');
    expect(setArg.n).toBe(3);
    expect(setArg.active).toBe(true);
  });

  it('normalizes deeply nested arrays of objects with builders', () => {
    const inner = cosine.range(-1, 1);
    const result = s('bd').set({
      effects: [
        { mod: inner, level: 0.5, name: 'chorus' },
        { mod: saw.fast(2), level: 0.3, name: 'flanger' },
      ],
    });
    const json = result.toJSON();
    const setArg = json.args[0] as Record<string, unknown>;
    const effects = setArg.effects as Array<Record<string, unknown>>;
    expect(effects.length).toBe(2);
    expect((effects[0]?.mod as { kind: string }).kind).toBe('method');
    expect(effects[0]?.name).toBe('chorus');
    expect((effects[1]?.mod as { kind: string }).kind).toBe('method');
    expect(effects[1]?.name).toBe('flanger');
  });

  it('clones builder expressions so independent uses do not share references', () => {
    const mod = sine.range(0, 1);
    const r1 = s('bd').gain(mod);
    const r2 = s('hh').gain(mod);
    const arg1 = r1.toJSON().args[0];
    const arg2 = r2.toJSON().args[0];
    expect(arg1).toEqual(arg2);
    expect(arg1).not.toBe(arg2);
  });

  it('throws for unsupported types like functions and symbols', () => {
    expect(() => s('bd').set((() => {}) as unknown)).toThrow('Unsupported structural value');
    expect(() => s('bd').set(Symbol('x') as unknown)).toThrow('Unsupported structural value');
  });
});

// ---------------------------------------------------------------------------
// G.07: Exported signal constants
// ---------------------------------------------------------------------------
describe('G.07 — exported signal constants', () => {
  const signalEntries = [
    { name: 'rand', constant: rand },
    { name: 'perlin', constant: perlin },
    { name: 'cosine', constant: cosine },
    { name: 'saw', constant: saw },
    { name: 'sine', constant: sine },
    { name: 'square', constant: square },
    { name: 'triangle', constant: triangle },
    { name: 'tri', constant: tri },
  ] as const;

  for (const { name, constant } of signalEntries) {
    it(`${name} is a SignalBuilder with correct name and exprType`, () => {
      expect(constant).toBeInstanceOf(SignalBuilder);
      expect(constant.toJSON().kind).toBe('call');
      expect(constant.toJSON().name).toBe(name);
      expect(constant.toJSON().exprType).toBe('signal');
    });
  }

  it('all signal constants support .range().fast() chaining', () => {
    for (const { constant } of signalEntries) {
      const result = constant.range(0, 1).fast(2);
      expect(result).toBeInstanceOf(SignalBuilder);
      expect(result.toJSON().kind).toBe('method');
      expect(result.toJSON().name).toBe('fast');
      expect(result.toJSON().exprType).toBe('signal');
    }
  });

  it('signal constants can be passed as arguments to pattern methods', () => {
    const result = s('bd').gain(sine).pan(cosine).speed(rand);
    const json = result.toJSON();
    // speed is the outermost
    expect(json.name).toBe('speed');
    const speedArg = json.args[0] as { kind: string; name: string; exprType: string };
    expect(speedArg.kind).toBe('call');
    expect(speedArg.name).toBe('rand');
    expect(speedArg.exprType).toBe('signal');
  });

  it('signal constants render with correct .show() output', () => {
    // Signals in SIGNAL_IDENTIFIERS render without parens
    expect(sine.show()).toBe('sine');
    expect(saw.show()).toBe('saw');
    expect(tri.show()).toBe('tri');
    expect(triangle.show()).toBe('triangle');
    expect(square.show()).toBe('square');
    expect(rand.show()).toBe('rand');
    expect(perlin.show()).toBe('perlin');
    // cosine is not in SIGNAL_IDENTIFIERS so renders with parens
    expect(cosine.show()).toBe('cosine()');
  });
});
