import {
  __tusselRecorder,
  add,
  areStringPrototypeExtensionsInstalled,
  cc,
  clearHydra,
  compress,
  contract,
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
  type PatternBuilder,
  pace,
  rev,
  s,
  scene,
  scramble,
  setcpm,
  setcps,
  setInputValue,
  shrink,
  shuffle,
  silence,
  slow,
  slowGap,
  sound,
  stack,
  stepcat,
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
