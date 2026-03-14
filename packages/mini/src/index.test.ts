import { inferMiniSteps, queryMini, showFirstCycle } from '@tussel/mini';
import { describe, expect, it } from 'vitest';

describe('mini', () => {
  it('renders a simple sequence', () => {
    expect(showFirstCycle('a b')).toEqual(['a: 0 - 0.5', 'b: 0.5 - 1']);
  });

  it('supports "-" as a rest alias like Strudel mini', () => {
    expect(showFirstCycle('a - b')).toEqual(showFirstCycle('a ~ b'));
  });

  it('supports "!" postfix repeats', () => {
    expect(showFirstCycle('a!3 b')).toEqual(['a: 0 - 0.25', 'a: 0.25 - 0.5', 'a: 0.5 - 0.75', 'b: 0.75 - 1']);
  });

  it('supports "@n" postfix repeats for stretched rests used in Strudel examples', () => {
    expect(showFirstCycle('[~@3 x]')).toEqual(['x: 0.75 - 1']);
  });

  it('supports rests and repetition', () => {
    expect(showFirstCycle('a ~ b*2')).toEqual([
      'a: 0 - 0.333333',
      'b: 0.666667 - 0.833333',
      'b: 0.833333 - 1',
    ]);
  });

  it('supports stacked groups', () => {
    expect(showFirstCycle('[a,b] c')).toEqual(['a: 0 - 0.5', 'b: 0 - 0.5', 'c: 0.5 - 1']);
  });

  it('supports nested groups', () => {
    expect(showFirstCycle('[[a b] [c d]]')).toEqual([
      'a: 0 - 0.25',
      'b: 0.25 - 0.5',
      'c: 0.5 - 0.75',
      'd: 0.75 - 1',
    ]);
  });

  it('supports slowcat across cycles', () => {
    expect(
      queryMini('<a b>', 0, 2).map(
        (event: { begin: number; end: number; value: string }) =>
          `${event.value}:${event.begin}-${event.end}`,
      ),
    ).toEqual(['a:0-1', 'b:1-2']);
  });

  it('expands prefixed variant groups like sd:<2 3>', () => {
    expect(
      queryMini('sd:<2 3>', 0, 2).map(
        (event: { begin: number; end: number; value: string }) =>
          `${event.value}:${event.begin}-${event.end}`,
      ),
    ).toEqual(['sd:2:0-1', 'sd:3:1-2']);
  });

  it('supports numeric euclidean rhythms like Strudel mini', () => {
    expect(showFirstCycle('a(3, 8)')).toEqual(['a: 0 - 0.125', 'a: 0.375 - 0.5', 'a: 0.75 - 0.875']);
    expect(showFirstCycle('x(5,8)')).toEqual([
      'x: 0 - 0.125',
      'x: 0.25 - 0.375',
      'x: 0.375 - 0.5',
      'x: 0.625 - 0.75',
      'x: 0.75 - 0.875',
    ]);
  });

  it('supports euclidean rotation', () => {
    expect(showFirstCycle('a(3,8,1)')).toEqual(['a: 0.125 - 0.25', 'a: 0.5 - 0.625', 'a: 0.875 - 1']);
  });

  it('supports division postfix timing', () => {
    expect(showFirstCycle('a/2 b')).toEqual(['a: 0 - 0.666667', 'b: 0.666667 - 1']);
  });

  it('supports direct colon variants', () => {
    expect(showFirstCycle('bd:2')).toEqual(['bd:2: 0 - 1']);
  });

  it('infers top-level step counts for stepwise helpers', () => {
    expect(inferMiniSteps('a [b c] d e')).toBe(4);
    expect(inferMiniSteps('a [^b c] d e')).toBe(8);
    expect(inferMiniSteps('bd hh hh cp hh')).toBe(5);
    expect(inferMiniSteps('e3@3 g3')).toBe(4);
  });

  it('returns empty output for empty mini source', () => {
    expect(showFirstCycle('')).toEqual([]);
    expect(inferMiniSteps('')).toBe(0);
  });

  it('throws useful errors for malformed groups', () => {
    expect(() => showFirstCycle('[a b')).toThrow('Unterminated [ group in mini source');
  });

  it('handles long and deeply nested patterns', () => {
    const longPattern = Array.from({ length: 64 }, (_, index) => `x${index}`).join(' ');
    expect(showFirstCycle(longPattern)).toHaveLength(64);
    expect(showFirstCycle('[a [b [c [d e]]]] f')).toEqual([
      'a: 0 - 0.25',
      'b: 0.25 - 0.375',
      'c: 0.375 - 0.4375',
      'd: 0.4375 - 0.46875',
      'e: 0.46875 - 0.5',
      'f: 0.5 - 1',
    ]);
  });
});
