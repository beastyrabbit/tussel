import { describe, expect, it } from 'vitest';
import { translateTidalToSceneModule, translateTidalToStrudelProgram } from './tidal.js';

describe('Tidal dialect translation', () => {
  // ---------------------------------------------------------------------------
  // Basic channel patterns
  // ---------------------------------------------------------------------------

  it('translates a simple d1 $ s pattern', () => {
    const result = translateTidalToStrudelProgram('d1 $ s "bd sd"');
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]?.channel).toBe('d1');
    expect(result.channels[0]?.expr).toBe('s("bd sd")');
  });

  it('translates multiple channels', () => {
    const result = translateTidalToStrudelProgram('d1 $ s "bd"\nd2 $ s "hh"');
    expect(result.channels).toHaveLength(2);
    expect(result.channels[0]?.channel).toBe('d1');
    expect(result.channels[1]?.channel).toBe('d2');
  });

  it('translates note patterns', () => {
    const result = translateTidalToStrudelProgram('d1 $ note "0 3 7"');
    expect(result.channels[0]?.expr).toBe('n("0 3 7")');
  });

  it('translates sound as alias for s', () => {
    const result = translateTidalToStrudelProgram('d1 $ sound "bd"');
    expect(result.channels[0]?.expr).toBe('s("bd")');
  });

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  it('parses setcps', () => {
    const result = translateTidalToStrudelProgram('setcps 0.5\nd1 $ s "bd"');
    expect(result.transport.cps).toBe(0.5);
  });

  it('parses setbpm', () => {
    const result = translateTidalToStrudelProgram('setbpm 120\nd1 $ s "bd"');
    expect(result.transport.bpm).toBe(120);
  });

  it('parses setcpm as bpm', () => {
    const result = translateTidalToStrudelProgram('setcpm 140\nd1 $ s "bd"');
    expect(result.transport.bpm).toBe(140);
  });

  // ---------------------------------------------------------------------------
  // $ operator chaining
  // ---------------------------------------------------------------------------

  it('translates $ chained transforms', () => {
    const result = translateTidalToStrudelProgram('d1 $ fast 2 $ s "bd sd"');
    expect(result.channels[0]?.expr).toBe('s("bd sd").fast(2)');
  });

  it('translates # control patterns', () => {
    const result = translateTidalToStrudelProgram('d1 $ s "bd" # gain 0.5');
    expect(result.channels[0]?.expr).toBe('s("bd").gain(0.5)');
  });

  it('translates rev (no argument)', () => {
    const result = translateTidalToStrudelProgram('d1 $ rev $ s "bd sd"');
    expect(result.channels[0]?.expr).toBe('s("bd sd").rev()');
  });

  // ---------------------------------------------------------------------------
  // Bindings
  // ---------------------------------------------------------------------------

  it('resolves bindings', () => {
    const result = translateTidalToStrudelProgram('pat = s "bd sd"\nd1 $ pat');
    expect(result.channels[0]?.expr).toBe('s("bd sd")');
  });

  it('resolves single binding as root', () => {
    const result = translateTidalToStrudelProgram('pat = s "bd"');
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]?.expr).toBe('s("bd")');
  });

  it('resolves binding with --entry', () => {
    const result = translateTidalToStrudelProgram('a = s "bd"\nb = s "hh"', { entry: 'b' });
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]?.expr).toBe('s("hh")');
  });

  // ---------------------------------------------------------------------------
  // Root expression
  // ---------------------------------------------------------------------------

  it('treats bare expression as d1 root', () => {
    const result = translateTidalToStrudelProgram('s "bd sd"');
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]?.channel).toBe('d1');
  });

  // ---------------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------------

  it('strips Tidal comments (--)', () => {
    const result = translateTidalToStrudelProgram('d1 $ s "bd" -- kick drum');
    expect(result.channels[0]?.expr).toBe('s("bd")');
  });

  it('strips JS comments (//)', () => {
    const result = translateTidalToStrudelProgram('d1 $ s "bd" // kick drum');
    expect(result.channels[0]?.expr).toBe('s("bd")');
  });

  // ---------------------------------------------------------------------------
  // Scene module output
  // ---------------------------------------------------------------------------

  it('generates a valid scene module', () => {
    const module = translateTidalToSceneModule('d1 $ s "bd sd"');
    expect(module).toContain('import { defineScene');
    expect(module).toContain('export default defineScene');
    expect(module).toContain('s("bd sd")');
  });

  it('includes transport in scene module when cps is set', () => {
    const module = translateTidalToSceneModule('setcps 0.5\nd1 $ s "bd"');
    expect(module).toContain('cps: 0.5');
  });

  // ---------------------------------------------------------------------------
  // Error cases
  // ---------------------------------------------------------------------------

  it('throws on ambiguous bindings without entry', () => {
    expect(() => translateTidalToStrudelProgram('a = s "bd"\nb = s "hh"')).toThrow('Ambiguous');
  });

  it('throws on missing entry binding', () => {
    expect(() => translateTidalToStrudelProgram('a = s "bd"', { entry: 'nonexistent' })).toThrow(
      'Unable to resolve',
    );
  });

  it('throws on empty source', () => {
    expect(() => translateTidalToStrudelProgram('')).toThrow();
  });

  it('throws on unsupported transform', () => {
    expect(() => translateTidalToStrudelProgram('d1 $ notAFunction 2 $ s "bd"')).toThrow();
  });

  // ---------------------------------------------------------------------------
  // Multiple transforms
  // ---------------------------------------------------------------------------

  it('chains multiple # controls', () => {
    const result = translateTidalToStrudelProgram('d1 $ s "bd" # gain 0.5 # pan 0.3');
    expect(result.channels[0]?.expr).toBe('s("bd").gain(0.5).pan(0.3)');
  });

  it('chains $ and # together', () => {
    const result = translateTidalToStrudelProgram('d1 $ fast 2 $ s "bd sd" # gain 0.8');
    // In Tidal, # binds tighter than $, so gain applies first, then fast wraps
    expect(result.channels[0]?.expr).toBe('s("bd sd").gain(0.8).fast(2)');
  });

  // ---------------------------------------------------------------------------
  // Edge cases — empty / whitespace
  // ---------------------------------------------------------------------------

  it('throws on whitespace-only source', () => {
    expect(() => translateTidalToStrudelProgram('   \n  \n  ')).toThrow();
  });

  it('throws on source with only comments', () => {
    expect(() => translateTidalToStrudelProgram('-- just a comment\n// another comment')).toThrow();
  });

  // ---------------------------------------------------------------------------
  // Nested pattern expressions
  // ---------------------------------------------------------------------------

  it('translates nested parenthesised sub-expressions', () => {
    const result = translateTidalToStrudelProgram('d1 $ s "bd" # gain (0.5)');
    expect(result.channels[0]?.expr).toBe('s("bd").gain(0.5)');
  });

  it('translates slow with a numeric argument', () => {
    const result = translateTidalToStrudelProgram('d1 $ slow 3 $ s "bd sd hh"');
    expect(result.channels[0]?.expr).toBe('s("bd sd hh").slow(3)');
  });

  it('chains multiple $ transforms in order', () => {
    const result = translateTidalToStrudelProgram('d1 $ slow 2 $ fast 4 $ s "bd"');
    expect(result.channels[0]?.expr).toBe('s("bd").fast(4).slow(2)');
  });

  it('translates degrade (no-arg method) via $', () => {
    const result = translateTidalToStrudelProgram('d1 $ degrade $ s "bd sd"');
    expect(result.channels[0]?.expr).toBe('s("bd sd").degrade()');
  });

  // ---------------------------------------------------------------------------
  // Transport edge cases
  // ---------------------------------------------------------------------------

  it('parses fractional cps', () => {
    const result = translateTidalToStrudelProgram('setcps 0.125\nd1 $ s "bd"');
    expect(result.transport.cps).toBe(0.125);
  });

  it('ignores transport lines that are not numeric', () => {
    expect(() => translateTidalToStrudelProgram('setcps notanumber\nd1 $ s "bd"')).toThrow(
      'Expected numeric literal',
    );
  });

  // ---------------------------------------------------------------------------
  // Bindings in expressions
  // ---------------------------------------------------------------------------

  it('resolves a binding used in a channel expression', () => {
    const result = translateTidalToStrudelProgram('drums = s "bd sd"\nd1 $ drums');
    expect(result.channels[0]?.expr).toBe('s("bd sd")');
  });

  // ---------------------------------------------------------------------------
  // Scene module output edge cases
  // ---------------------------------------------------------------------------

  it('generates scene module with bpm transport', () => {
    const module = translateTidalToSceneModule('setbpm 90\nd1 $ s "bd"');
    expect(module).toContain('bpm: 90');
  });

  it('generates scene module with multiple channels', () => {
    const module = translateTidalToSceneModule('d1 $ s "bd"\nd2 $ s "hh"\nd3 $ note "0 3"');
    expect(module).toContain('"d1"');
    expect(module).toContain('"d2"');
    expect(module).toContain('"d3"');
  });

  it('generates scene module without transport when none is set', () => {
    const module = translateTidalToSceneModule('d1 $ s "bd"');
    // Transport block should exist but be essentially empty (no cps/bpm lines)
    expect(module).not.toContain('cps:');
    expect(module).not.toContain('bpm:');
  });

  // ---------------------------------------------------------------------------
  // Circular binding detection (audit fix 1)
  // ---------------------------------------------------------------------------

  it('throws on circular binding a = b, b = a', () => {
    expect(() => translateTidalToStrudelProgram('a = b\nb = a\nd1 $ a')).toThrow('Circular binding');
  });

  it('throws on self-referential binding x = x', () => {
    expect(() => translateTidalToStrudelProgram('x = x\nd1 $ x')).toThrow('Circular binding');
  });

  it('resolves valid binding chains without error', () => {
    const result = translateTidalToStrudelProgram('a = s "bd"\nb = a\nd1 $ b');
    expect(result.channels[0]?.expr).toBe('s("bd")');
  });

  it('throws on indirect circular binding a = b, b = c, c = a', () => {
    expect(() => translateTidalToStrudelProgram('a = b\nb = c\nc = a\nd1 $ a')).toThrow('Circular binding');
  });
});
