import { TusselParseError } from '@tussel/ir';
import { inferMiniSteps, parseMini, queryMini, showFirstCycle } from '@tussel/mini';
import { describe, expect, it } from 'vitest';

describe('mini edge cases', () => {
  // ── 1. Nested groups ──────────────────────────────────────────────────
  describe('nested groups', () => {
    it('renders [bd [sd hh]] with inner group subdivided', () => {
      const events = showFirstCycle('[bd [sd hh]]');
      expect(events).toEqual(['bd: 0 - 0.5', 'hh: 0.75 - 1', 'sd: 0.5 - 0.75']);
    });

    it('renders [[a b] [c d]] as four equal slots', () => {
      const events = showFirstCycle('[[a b] [c d]]');
      expect(events).toEqual(['a: 0 - 0.25', 'b: 0.25 - 0.5', 'c: 0.5 - 0.75', 'd: 0.75 - 1']);
    });

    it('handles nested group at start of outer group', () => {
      const events = showFirstCycle('[[a b] c]');
      expect(events).toEqual(['a: 0 - 0.25', 'b: 0.25 - 0.5', 'c: 0.5 - 1']);
    });
  });

  // ── 2. Deep nesting ───────────────────────────────────────────────────
  describe('deep nesting (3+ levels)', () => {
    it('renders [[[bd]]] as a single event spanning the cycle', () => {
      const events = showFirstCycle('[[[bd]]]');
      expect(events).toEqual(['bd: 0 - 1']);
    });

    it('renders 4-level nesting with multiple leaves', () => {
      const events = showFirstCycle('[a [b [c [d e]]]]');
      expect(events).toEqual([
        'a: 0 - 0.5',
        'b: 0.5 - 0.75',
        'c: 0.75 - 0.875',
        'd: 0.875 - 0.9375',
        'e: 0.9375 - 1',
      ]);
    });

    it('renders 5-level deeply nested single element', () => {
      const events = showFirstCycle('[[[[[ x ]]]]]');
      expect(events).toEqual(['x: 0 - 1']);
    });
  });

  // ── 3. Division operator / ────────────────────────────────────────────
  describe('division operator /', () => {
    it('bd/2 doubles the time span (halves speed)', () => {
      const events = showFirstCycle('bd/2 sd');
      // bd has factor 2, sd has factor 1 => total 3
      // bd occupies 2/3 of the cycle, sd occupies 1/3
      expect(events).toEqual(['bd: 0 - 0.666667', 'sd: 0.666667 - 1']);
    });

    it('bd/3 takes up 3x the space relative to normal tokens', () => {
      const events = showFirstCycle('bd/3 sd');
      // bd factor 3, sd factor 1 => total 4
      expect(events).toEqual(['bd: 0 - 0.75', 'sd: 0.75 - 1']);
    });

    it('division inside a group', () => {
      const events = showFirstCycle('[a/2 b]');
      // a factor 2, b factor 1 => total 3
      expect(events).toEqual(['a: 0 - 0.666667', 'b: 0.666667 - 1']);
    });
  });

  // ── 4. Multiplication by non-integers ─────────────────────────────────
  describe('multiplication by non-integers', () => {
    it('bd*1.5 produces events at correct timing positions', () => {
      const result = showFirstCycle('bd*1.5');
      expect(result.length).toBe(2);
      expect(result[0]).toMatch(/^bd: 0 - 0\.6666/);
      expect(result[1]).toMatch(/^bd: 0\.6666/);
    });

    it('bd*2.5 produces three events at correct timing positions', () => {
      const result = showFirstCycle('bd*2.5');
      expect(result.length).toBe(3);
      expect(result[0]).toMatch(/^bd: 0 - 0\.4/);
      expect(result[1]).toMatch(/^bd: 0\.4 - 0\.8/);
      expect(result[2]).toMatch(/^bd: 0\.8/);
    });
  });

  // ── 5. Empty input ────────────────────────────────────────────────────
  describe('empty input', () => {
    it('returns empty events for empty string', () => {
      expect(showFirstCycle('')).toEqual([]);
    });

    it('returns 0 steps for empty string', () => {
      expect(inferMiniSteps('')).toBe(0);
    });

    it('queryMini on empty string returns no events', () => {
      expect(queryMini('', 0, 1)).toEqual([]);
    });

    it('returns empty events for whitespace-only input', () => {
      expect(showFirstCycle('   ')).toEqual([]);
    });

    it('parseMini on empty string returns a seq with no items', () => {
      const node = parseMini('');
      expect(node).toEqual({ kind: 'seq', items: [], factor: 1 });
    });
  });

  // ── 6. Malformed input errors ─────────────────────────────────────────
  describe('malformed input errors', () => {
    it('throws for unterminated [', () => {
      expect(() => parseMini('[a b')).toThrow('Unterminated [ group');
    });

    it('throws for unterminated < (slowcat)', () => {
      expect(() => parseMini('<a b')).toThrow('Unterminated < group');
    });

    it('throws for deeply unterminated nesting [a [b c]', () => {
      expect(() => parseMini('[a [b c]')).toThrow('Unterminated [ group');
    });

    it('handles extra closing bracket by treating it as unexpected token', () => {
      // A lone ']' at top level: the parser's readToken will try to consume it.
      // In readToken, ']' matches /[\s,[\]<>*/!@]/ so the loop breaks immediately,
      // producing an empty token which throws "Unexpected token".
      expect(() => parseMini(']')).toThrow();
    });

    it('handles extra closing > at top level', () => {
      expect(() => parseMini('>')).toThrow();
    });

    it('throws for * without a number', () => {
      expect(() => parseMini('bd*')).toThrow();
    });

    it('throws for / without a number', () => {
      expect(() => parseMini('bd/')).toThrow();
    });

    it('throws for ! without a number', () => {
      expect(() => parseMini('bd!')).toThrow();
    });

    it('throws for negative postfix number', () => {
      // readNumber requires value > 0
      expect(() => parseMini('bd*0')).toThrow('Invalid mini numeric postfix');
    });
  });

  // ── 7. Unicode input ──────────────────────────────────────────────────
  describe('unicode input', () => {
    it('handles emoji as tokens', () => {
      const events = showFirstCycle('\u{1F941} \u{1F3B6}');
      expect(events).toHaveLength(2);
      // Output is sorted alphabetically; just check both emoji appear somewhere
      const joined = events.join(' ');
      expect(joined).toContain('\u{1F941}');
      expect(joined).toContain('\u{1F3B6}');
    });

    it('handles CJK characters as tokens', () => {
      const events = showFirstCycle('\u592A\u9F13 \u9227');
      expect(events).toHaveLength(2);
      expect(events[0]).toContain('\u592A\u9F13');
      expect(events[1]).toContain('\u9227');
    });

    it('handles accented characters', () => {
      const events = showFirstCycle('\u00E9 \u00FC \u00F1');
      expect(events).toHaveLength(3);
    });

    it('handles mixed ASCII and unicode', () => {
      const events = showFirstCycle('bd \u{1F941} sd');
      expect(events).toHaveLength(3);
    });
  });

  // ── 8. Very long patterns ─────────────────────────────────────────────
  describe('very long patterns', () => {
    it('handles 100 items', () => {
      const pattern = Array.from({ length: 100 }, (_, i) => `n${i}`).join(' ');
      const events = showFirstCycle(pattern);
      expect(events).toHaveLength(100);
    });

    it('handles 200 items without crashing', () => {
      const pattern = Array.from({ length: 200 }, (_, i) => `x${i}`).join(' ');
      const events = showFirstCycle(pattern);
      expect(events).toHaveLength(200);
    });

    it('correctly spaces 100 items across the cycle', () => {
      const pattern = Array.from({ length: 100 }, () => 'a').join(' ');
      const events = queryMini(pattern, 0, 1);
      expect(events).toHaveLength(100);
      // Each event should span 0.01 of the cycle
      const first = events[0];
      expect(first?.begin).toBe(0);
      expect(first?.end).toBeCloseTo(0.01, 10);
    });
  });

  // ── 9. Euclidean rhythms in groups ────────────────────────────────────
  describe('euclidean rhythms inside groups', () => {
    it('renders bd(3,8) inside a group', () => {
      const events = showFirstCycle('[bd(3,8) sd]');
      // bd(3,8) expands to [bd ~ ~ bd ~ bd ~ ~] inside the group
      // so the group has two items: [bd ~ ~ bd ~ bd ~ ~] and sd
      // Each top-level group item gets half the cycle
      expect(events.filter((e) => e.startsWith('bd'))).toHaveLength(3);
      expect(events.filter((e) => e.startsWith('sd'))).toHaveLength(1);
    });

    it('renders euclidean rhythm at top level', () => {
      const events = showFirstCycle('bd(3,8)');
      expect(events.filter((e) => e.startsWith('bd'))).toHaveLength(3);
    });

    it('renders nested euclidean with other patterns', () => {
      const events = showFirstCycle('bd(3,8) hh*4');
      // Two top-level items: [bd~...] and hh*4
      expect(events.filter((e) => e.startsWith('bd'))).toHaveLength(3);
      expect(events.filter((e) => e.startsWith('hh'))).toHaveLength(4);
    });
  });

  // ── 10. Euclidean rotation parameter ──────────────────────────────────
  describe('euclidean rotation parameter', () => {
    it('bd(3,8,0) is same as bd(3,8)', () => {
      expect(showFirstCycle('bd(3,8,0)')).toEqual(showFirstCycle('bd(3,8)'));
    });

    it('bd(3,8,1) rotates the pattern by 1', () => {
      const unrotated = showFirstCycle('bd(3,8)');
      const rotated = showFirstCycle('bd(3,8,1)');
      // Both should have 3 events, but at different positions
      expect(rotated).toHaveLength(3);
      expect(rotated).not.toEqual(unrotated);
    });

    it('bd(3,8,8) wraps back to same as bd(3,8,0)', () => {
      expect(showFirstCycle('bd(3,8,8)')).toEqual(showFirstCycle('bd(3,8,0)'));
    });

    it('negative rotation is supported', () => {
      const events = showFirstCycle('bd(3,8,-1)');
      expect(events).toHaveLength(3);
    });
  });

  // ── 11. Top-level comma-separated stacks ──────────────────────────────
  describe('top-level comma-separated stacks', () => {
    it('bd, sd, hh produces three simultaneous events', () => {
      const events = showFirstCycle('bd, sd, hh');
      expect(events).toHaveLength(3);
      // All three should span the full cycle
      expect(events).toContain('bd: 0 - 1');
      expect(events).toContain('hh: 0 - 1');
      expect(events).toContain('sd: 0 - 1');
    });

    it('comma inside a group creates a stack layer', () => {
      const events = showFirstCycle('[a,b] c');
      expect(events).toEqual(['a: 0 - 0.5', 'b: 0 - 0.5', 'c: 0.5 - 1']);
    });

    it('multiple comma-separated items with sequences', () => {
      // [a b, c d] parses as a group with stack: the comma separates
      // after 'b' is parsed as an item. The stack item is {a, b} vs {c, d}
      // where each stack layer is a single item occupying one slot in the group.
      // Actually the parser builds: group items = [stackItem(a, c), stackItem(b, d)]
      // because comma splits within parseStackItem per position.
      // Let's just check the actual output shape.
      const events = showFirstCycle('[a b, c d]');
      expect(events).toHaveLength(4);
      const values = events.map((e) => e.split(':')[0]);
      expect(values).toContain('a');
      expect(values).toContain('b');
      expect(values).toContain('c');
      expect(values).toContain('d');
    });
  });

  // ── 12. Colon variants ────────────────────────────────────────────────
  describe('colon variants', () => {
    it('bd:2 is a single literal token "bd:2"', () => {
      const events = showFirstCycle('bd:2');
      expect(events).toEqual(['bd:2: 0 - 1']);
    });

    it('sd:1 hh:3 produces two tokens with colon notation', () => {
      const events = showFirstCycle('sd:1 hh:3');
      expect(events).toEqual(['hh:3: 0.5 - 1', 'sd:1: 0 - 0.5']);
    });

    it('colon with longer suffix', () => {
      const events = showFirstCycle('bd:soft');
      expect(events).toEqual(['bd:soft: 0 - 1']);
    });
  });

  // ── 13. Decimal pattern weights (@) ───────────────────────────────────
  describe('decimal pattern weights @', () => {
    it('@0.5 stretches the item', () => {
      const events = showFirstCycle('[a@0.5 b]');
      // a has stretch factor 0.5, b has factor 1 => total 1.5
      // a occupies 0.5/1.5 = 1/3, b occupies 1/1.5 = 2/3
      expect(events).toHaveLength(2);
      expect(events).toContain('a: 0 - 0.333333');
      expect(events).toContain('b: 0.333333 - 1');
    });

    it('@2 doubles the weight of an item', () => {
      const events = showFirstCycle('[a@2 b]');
      // a factor 2, b factor 1 => total 3
      expect(events).toContain('a: 0 - 0.666667');
      expect(events).toContain('b: 0.666667 - 1');
    });

    it('@3 with rest for rhythmic spacing', () => {
      const events = showFirstCycle('[~@3 x]');
      // rest@3: rest factor 3, x factor 1 => total 4
      // rest occupies 3/4, x occupies 1/4
      expect(events).toEqual(['x: 0.75 - 1']);
    });
  });

  // ── 14. Slowcat basics ────────────────────────────────────────────────
  describe('slowcat <> basics', () => {
    it('alternates items across cycles', () => {
      const events = queryMini('<a b c>', 0, 3);
      expect(events).toEqual([
        { begin: 0, end: 1, value: 'a' },
        { begin: 1, end: 2, value: 'b' },
        { begin: 2, end: 3, value: 'c' },
      ]);
    });

    it('wraps around when querying more cycles than items', () => {
      const events = queryMini('<a b>', 0, 4);
      expect(events).toEqual([
        { begin: 0, end: 1, value: 'a' },
        { begin: 1, end: 2, value: 'b' },
        { begin: 2, end: 3, value: 'a' },
        { begin: 3, end: 4, value: 'b' },
      ]);
    });

    it('single-item slowcat is same as plain item', () => {
      expect(showFirstCycle('<a>')).toEqual(showFirstCycle('a'));
    });
  });

  // ── 15. Nested slowcat inside groups ──────────────────────────────────
  describe('nested slowcat inside groups', () => {
    it('[<bd sd> hh] alternates the first item across cycles', () => {
      const cycle0 = queryMini('[<bd sd> hh]', 0, 1);
      const cycle1 = queryMini('[<bd sd> hh]', 1, 2);

      // Cycle 0: <bd sd> picks bd; hh is always present
      expect(cycle0.map((e) => e.value)).toContain('bd');
      expect(cycle0.map((e) => e.value)).toContain('hh');
      expect(cycle0.map((e) => e.value)).not.toContain('sd');

      // Cycle 1: <bd sd> picks sd
      expect(cycle1.map((e) => e.value)).toContain('sd');
      expect(cycle1.map((e) => e.value)).toContain('hh');
      expect(cycle1.map((e) => e.value)).not.toContain('bd');
    });

    it('slowcat inside nested groups', () => {
      const events0 = queryMini('[[<a b> c] d]', 0, 1);
      const events1 = queryMini('[[<a b> c] d]', 1, 2);

      expect(events0.map((e) => e.value)).toContain('a');
      expect(events0.map((e) => e.value)).not.toContain('b');
      expect(events1.map((e) => e.value)).toContain('b');
      expect(events1.map((e) => e.value)).not.toContain('a');
    });
  });

  // ── 16. Stepwise [^ ] markers ─────────────────────────────────────────
  describe('stepwise [^ ] markers', () => {
    it('[^ ] sets stepSource flag and affects inferMiniSteps', () => {
      // Without stepwise: [b c] counts as 1 top-level step, so total = 4
      expect(inferMiniSteps('a [b c] d e')).toBe(4);
      // With stepwise: [^b c] inner items contribute individually
      expect(inferMiniSteps('a [^b c] d e')).toBe(8);
    });

    it('stepwise marker on slowcat <^a b>', () => {
      const node = parseMini('<^a b>');
      expect(node.kind).toBe('seq');
      if (node.kind === 'seq') {
        const slowcat = node.items[0];
        expect(slowcat?.kind).toBe('slowcat');
        if (slowcat?.kind === 'slowcat') {
          expect(slowcat.stepSource).toBe(true);
        }
      }
    });

    it('[^a b c] within sequence changes step inference', () => {
      // 3 items in stepwise group should multiply the step count
      const steps = inferMiniSteps('[^a b c] d');
      expect(steps).toBeGreaterThan(2);
    });
  });

  // ── 17. Rest handling ~ and - ─────────────────────────────────────────
  describe('rest handling ~ and -', () => {
    it('~ produces silence (no event output)', () => {
      const events = showFirstCycle('a ~ b');
      expect(events).toEqual(['a: 0 - 0.333333', 'b: 0.666667 - 1']);
    });

    it('- is treated same as ~', () => {
      expect(showFirstCycle('a - b')).toEqual(showFirstCycle('a ~ b'));
    });

    it('all rests produce empty output', () => {
      expect(showFirstCycle('~ ~ ~')).toEqual([]);
    });

    it('rest inside a group', () => {
      const events = showFirstCycle('[a ~ b]');
      expect(events).toEqual(['a: 0 - 0.333333', 'b: 0.666667 - 1']);
    });

    it('rest with stretch @', () => {
      const events = showFirstCycle('[~@2 a]');
      // rest factor 2, a factor 1 => total 3
      expect(events).toEqual(['a: 0.666667 - 1']);
    });

    it('multiple consecutive rests', () => {
      const events = showFirstCycle('~ ~ ~ a');
      expect(events).toEqual(['a: 0.75 - 1']);
    });
  });

  // ── 18. Multiple postfix operators ────────────────────────────────────
  describe('multiple postfix operators', () => {
    it('bd*2!3 applies both repeat and replicate', () => {
      // *2 creates repeat(count=2), then !3 wraps that in repeat(count=3)
      const events = showFirstCycle('bd*2!3');
      // The outer !3 repeats the inner *2 node 3 times,
      // and the inner *2 repeats bd 2 times within each slot.
      // So we should get 6 bd events total.
      expect(events).toHaveLength(6);
      expect(events.every((e) => e.startsWith('bd'))).toBe(true);
    });

    it('bd*2/3 applies repeat then division', () => {
      // *2 creates a repeat node, then /3 multiplies the factor by 3
      const events = showFirstCycle('bd*2/3 sd');
      // bd has factor 3 (from /3), sd has factor 1 => total 4
      // bd occupies 3/4 of cycle, within which *2 repeats it twice
      expect(events.filter((e) => e.startsWith('bd'))).toHaveLength(2);
      expect(events.filter((e) => e.startsWith('sd'))).toHaveLength(1);
    });

    it('bd@2*3 stretch then repeat', () => {
      const events = showFirstCycle('bd@2*3');
      // @2 creates stretch node with factor 2, then *3 repeats 3 times
      // The repeat inherits the factor from stretch
      expect(events.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ── 19. Prefix group notation ─────────────────────────────────────────
  describe('prefix group notation', () => {
    it('bd:[0 1 2] expands to [bd:0 bd:1 bd:2]', () => {
      const events = showFirstCycle('bd:[0 1 2]');
      expect(events).toEqual(['bd:0: 0 - 0.333333', 'bd:1: 0.333333 - 0.666667', 'bd:2: 0.666667 - 1']);
    });

    it('sd:<2 3> expands with slowcat across cycles', () => {
      const cycle0 = queryMini('sd:<2 3>', 0, 1);
      const cycle1 = queryMini('sd:<2 3>', 1, 2);
      expect(cycle0[0]?.value).toBe('sd:2');
      expect(cycle1[0]?.value).toBe('sd:3');
    });

    it('prefix group with nested group inside', () => {
      const events = showFirstCycle('bd:[[0 1] 2]');
      expect(events).toEqual(['bd:0: 0 - 0.25', 'bd:1: 0.25 - 0.5', 'bd:2: 0.5 - 1']);
    });

    it('prefix does not apply to rests inside the group', () => {
      const events = showFirstCycle('bd:[0 ~ 2]');
      expect(events).toHaveLength(2);
      expect(events).toContain('bd:0: 0 - 0.333333');
      expect(events).toContain('bd:2: 0.666667 - 1');
    });
  });

  // ── 20. inferMiniSteps for various patterns ───────────────────────────
  describe('inferMiniSteps', () => {
    it('single token = 1 step', () => {
      expect(inferMiniSteps('bd')).toBe(1);
    });

    it('three top-level tokens = 3 steps', () => {
      expect(inferMiniSteps('bd sd hh')).toBe(3);
    });

    it('group counts as 1 step at top level', () => {
      expect(inferMiniSteps('[a b c] d')).toBe(2);
    });

    it('stepwise group expands step count', () => {
      expect(inferMiniSteps('[^a b c] d')).toBe(6);
    });

    it('stretch @3 adds 3 to step total', () => {
      expect(inferMiniSteps('e3@3 g3')).toBe(4);
    });

    it('euclidean pattern step count', () => {
      const steps = inferMiniSteps('bd(3,8)');
      // bd(3,8) expands to [bd ~ ~ bd ~ bd ~ ~] which is a single group node
      // at the top-level seq. The seq has 1 item with factor 1, so steps = 1.
      expect(steps).toBe(1);
    });

    it('empty pattern = 0 steps', () => {
      expect(inferMiniSteps('')).toBe(0);
    });

    it('pattern with rests counts them as steps', () => {
      expect(inferMiniSteps('a ~ b')).toBe(3);
    });

    it('slowcat at top level counts as 1 seq item', () => {
      // The slowcat <a b c> is a single item in the top-level seq.
      // countSteps for seq sums item factors. The slowcat has factor 1.
      expect(inferMiniSteps('<a b c>')).toBe(1);
    });
  });

  // ── 21. showFirstCycle output format ──────────────────────────────────
  describe('showFirstCycle output format', () => {
    it('format is "value: begin - end"', () => {
      const events = showFirstCycle('bd');
      expect(events).toEqual(['bd: 0 - 1']);
    });

    it('integer boundaries omit decimal points', () => {
      const events = showFirstCycle('a');
      expect(events[0]).toBe('a: 0 - 1');
    });

    it('fractional boundaries are formatted to 6 decimal places max', () => {
      const events = showFirstCycle('a b c');
      // a: 0 - 0.333333, b: 0.333333 - 0.666667, c: 0.666667 - 1
      expect(events[0]).toBe('a: 0 - 0.333333');
      expect(events[1]).toBe('b: 0.333333 - 0.666667');
      expect(events[2]).toBe('c: 0.666667 - 1');
    });

    it('output is sorted alphabetically', () => {
      const events = showFirstCycle('[c b a]');
      // Three events at positions 0, 1/3, 2/3 but sorted by the format string
      expect(events[0]).toContain('a:');
      expect(events[1]).toContain('b:');
      expect(events[2]).toContain('c:');
    });

    it('clean fractions avoid trailing zeros', () => {
      const events = showFirstCycle('a b');
      // 0.5 should not be 0.500000
      expect(events).toEqual(['a: 0 - 0.5', 'b: 0.5 - 1']);
    });

    it('stacked events are interleaved by value sort', () => {
      const events = showFirstCycle('bd,sd');
      expect(events).toEqual(['bd: 0 - 1', 'sd: 0 - 1']);
    });
  });

  // ── Additional edge cases ─────────────────────────────────────────────
  describe('additional edge cases', () => {
    it('queryMini across fractional cycle boundaries', () => {
      const events = queryMini('a b', 0.25, 0.75);
      // a spans 0-0.5, b spans 0.5-1 in cycle 0
      // Both overlap [0.25, 0.75]
      expect(events).toHaveLength(2);
    });

    it('queryMini with begin == end returns empty', () => {
      // beginCycle = endCycle = 0, but lastCycle = max(0+1, ceil(0)) = 1
      // so it still queries cycle 0. But events are filtered by spanEnd <= beginCycle
      // Actually beginCycle = 0, endCycle = 0. spanEnd <= beginCycle means spanEnd <= 0.
      // For cycle 0, spanBegin = 0, spanEnd = 1. 1 <= 0? No. spanBegin >= endCycle? 0 >= 0? Yes.
      // So it returns empty.
      const events = queryMini('a b', 0, 0);
      expect(events).toEqual([]);
    });

    it('parseMini preserves nested structure', () => {
      const node = parseMini('[a b]');
      expect(node.kind).toBe('seq');
      if (node.kind === 'seq') {
        expect(node.items).toHaveLength(1);
        const group = node.items[0];
        expect(group?.kind).toBe('group');
        if (group?.kind === 'group') {
          expect(group.items).toHaveLength(2);
        }
      }
    });

    it('handles tokens with dots and hyphens', () => {
      const events = showFirstCycle('c3 e3 g3');
      expect(events).toHaveLength(3);
    });

    it('handles dollar sign in tokens', () => {
      const events = showFirstCycle('$var1 $var2');
      expect(events).toHaveLength(2);
      expect(events[0]).toContain('$var1');
    });

    it('euclidean with pulses equal to steps gives all hits', () => {
      const events = showFirstCycle('bd(4,4)');
      expect(events).toHaveLength(4);
    });

    it('euclidean with 1 pulse gives one hit among rests', () => {
      const events = showFirstCycle('bd(1,4)');
      expect(events).toHaveLength(1);
    });

    it('invalid euclidean (pulses > steps) is not expanded', () => {
      // When pulses > steps, the regex keeps it as-is. But the comma is a stack
      // separator in the parser, so "bd(5,4)" gets parsed as a stack of "bd(5" and "4)".
      const events = showFirstCycle('bd(5,4)');
      // We just verify it doesn't crash and produces some output
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 22. Division operator `/` extended edge cases ────────────────────
  describe('division operator / extended edge cases', () => {
    it('bd/2 as a standalone token spans the full cycle', () => {
      const events = showFirstCycle('bd/2');
      // Only one token, factor is irrelevant alone -- it still spans 0-1
      expect(events).toEqual(['bd: 0 - 1']);
    });

    it('[bd sd]/3 applies division to the entire group', () => {
      const events = showFirstCycle('[bd sd]/3 hh');
      // Group has factor 3, hh has factor 1 => total 4
      // Group occupies 3/4 of the cycle, hh occupies 1/4
      const bdEvents = events.filter((e) => e.startsWith('bd'));
      const sdEvents = events.filter((e) => e.startsWith('sd'));
      const hhEvents = events.filter((e) => e.startsWith('hh'));
      expect(bdEvents).toHaveLength(1);
      expect(sdEvents).toHaveLength(1);
      expect(hhEvents).toHaveLength(1);
      // bd should start at 0, sd should end before 0.75, hh starts at 0.75
      expect(hhEvents[0]).toBe('hh: 0.75 - 1');
    });

    it('bd/1 is a no-op (factor stays 1)', () => {
      expect(showFirstCycle('bd/1 sd')).toEqual(['bd: 0 - 0.5', 'sd: 0.5 - 1']);
    });

    it('multiple divisions chain: bd/2/3 gives factor 6', () => {
      const events = showFirstCycle('bd/2/3 sd');
      // bd factor = 1 * 2 * 3 = 6, sd factor = 1 => total 7
      expect(events).toEqual(['bd: 0 - 0.857143', 'sd: 0.857143 - 1']);
    });

    it('division with decimal: bd/1.5 gives factor 1.5', () => {
      const events = showFirstCycle('bd/1.5 sd');
      // bd factor = 1.5, sd factor = 1 => total 2.5
      // bd occupies 1.5/2.5 = 0.6, sd occupies 1/2.5 = 0.4
      expect(events).toEqual(['bd: 0 - 0.6', 'sd: 0.6 - 1']);
    });

    it('division combined with repeat: bd*2/3 sd', () => {
      const events = showFirstCycle('bd*2/3 sd');
      // bd has factor 3 (from /3) and repeat count 2
      // bd factor 3, sd factor 1 => total 4
      // bd occupies 3/4, within which it repeats 2 times
      const bdEvents = events.filter((e) => e.startsWith('bd'));
      expect(bdEvents).toHaveLength(2);
      expect(events.filter((e) => e.startsWith('sd'))).toHaveLength(1);
    });

    it('division on a rest: ~/2 a gives rest more space', () => {
      const events = showFirstCycle('~/2 a');
      // rest factor 2, a factor 1 => total 3
      // rest occupies 2/3, a occupies 1/3
      expect(events).toEqual(['a: 0.666667 - 1']);
    });
  });

  // ── 23. Multiplication by non-integers - improved assertions ────────
  describe('multiplication by non-integers - improved assertions', () => {
    it('bd*1.5 produces 2 events with correct fractional timing', () => {
      const events = queryMini('bd*1.5', 0, 1);
      expect(events).toHaveLength(2);
      // Each repeat slot is 1/1.5 = 2/3 wide
      expect(events[0]?.begin).toBeCloseTo(0, 10);
      expect(events[0]?.end).toBeCloseTo(2 / 3, 5);
      expect(events[1]?.begin).toBeCloseTo(2 / 3, 5);
      expect(events[1]?.end).toBeCloseTo(4 / 3, 5);
      expect(events[0]?.value).toBe('bd');
      expect(events[1]?.value).toBe('bd');
    });

    it('bd*2.5 produces 3 events with correct positions', () => {
      const events = queryMini('bd*2.5', 0, 1);
      expect(events).toHaveLength(3);
      // Each slot width = 1/2.5 = 0.4
      expect(events[0]?.begin).toBeCloseTo(0, 10);
      expect(events[0]?.end).toBeCloseTo(0.4, 10);
      expect(events[1]?.begin).toBeCloseTo(0.4, 10);
      expect(events[1]?.end).toBeCloseTo(0.8, 10);
      expect(events[2]?.begin).toBeCloseTo(0.8, 10);
      expect(events[2]?.end).toBeCloseTo(1.2, 5);
    });

    it('hh*0.5 produces 1 event that extends beyond the cycle', () => {
      const events = queryMini('hh*0.5', 0, 1);
      // repeat count 0.5: width = 1/0.5 = 2. Loop: i=0 < 0.5 is false, so 0 iterations?
      // Actually the renderNode repeat loop runs: for (i = 0; i < count; i += 1)
      // 0 < 0.5 is true, so 1 iteration with childBegin=0, childEnd=2
      // The event span [0,2] overlaps [0,1] so it appears in the output
      expect(events).toHaveLength(1);
      expect(events[0]?.value).toBe('hh');
      expect(events[0]?.begin).toBe(0);
      expect(events[0]?.end).toBe(2);
    });

    it('sd*3.7 produces 4 events (floor of iterations with partial last)', () => {
      const events = queryMini('sd*3.7', 0, 1);
      // Loop: i=0,1,2,3 (3 < 3.7), so 4 iterations
      expect(events).toHaveLength(4);
      const width = 1 / 3.7;
      for (let i = 0; i < 4; i++) {
        expect(events[i]?.begin).toBeCloseTo(width * i, 5);
        expect(events[i]?.end).toBeCloseTo(width * (i + 1), 5);
        expect(events[i]?.value).toBe('sd');
      }
    });

    it('[a b]*1.5 repeats the group 1.5 times', () => {
      const events = queryMini('[a b]*1.5', 0, 1);
      // Each group repetition occupies 1/1.5 = 2/3 of the cycle
      // First group: a at [0, 1/3], b at [1/3, 2/3]
      // Partial second group not started? Let's check: i=0 runs, i=1 < 1.5 runs
      // So 2 iterations, each group renders 2 items = 4 events total
      // But second iteration extends beyond cycle end
      expect(events.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── 24. Empty and whitespace input edge cases ───────────────────────
  describe('empty and whitespace input edge cases', () => {
    it('tab-only input returns empty array', () => {
      expect(showFirstCycle('\t\t')).toEqual([]);
    });

    it('newline-only input returns empty array', () => {
      expect(showFirstCycle('\n\n')).toEqual([]);
    });

    it('mixed whitespace returns empty array', () => {
      expect(showFirstCycle(' \t \n ')).toEqual([]);
    });

    it('parseMini on whitespace-only returns seq with no items', () => {
      const node = parseMini('   \t  ');
      expect(node).toEqual({ kind: 'seq', items: [], factor: 1 });
    });

    it('inferMiniSteps on whitespace returns 0', () => {
      expect(inferMiniSteps('  \t  ')).toBe(0);
    });

    it('queryMini on whitespace-only returns empty', () => {
      expect(queryMini('   ', 0, 1)).toEqual([]);
    });
  });

  // ── 25. Malformed input - verify specific error messages ────────────
  describe('malformed input - specific error messages', () => {
    it('unterminated [ gives message mentioning [ group', () => {
      expect(() => parseMini('[a')).toThrow('Unterminated [ group in mini source');
    });

    it('unterminated < gives message mentioning < group', () => {
      expect(() => parseMini('<a')).toThrow('Unterminated < group in mini source');
    });

    it('bd*0 gives "Invalid mini numeric postfix" with the raw value', () => {
      expect(() => parseMini('bd*0')).toThrow('Invalid mini numeric postfix "0"');
    });

    it('bd/-1 gives "Invalid mini numeric postfix"', () => {
      // readNumber reads "-" but it's not a digit, so raw = "" which is NaN
      expect(() => parseMini('bd/-1')).toThrow('Invalid mini numeric postfix');
    });

    it('bd*abc gives "Invalid mini numeric postfix"', () => {
      // readNumber can't parse letters, raw = "" => NaN
      expect(() => parseMini('bd*abc')).toThrow('Invalid mini numeric postfix');
    });

    it('lone ] gives "Unexpected token" error', () => {
      expect(() => parseMini(']')).toThrow('Unexpected token');
    });

    it('lone > gives "Unexpected token" error', () => {
      expect(() => parseMini('>')).toThrow('Unexpected token');
    });

    it('bd* at end of input gives error', () => {
      expect(() => parseMini('bd*')).toThrow('Invalid mini numeric postfix');
    });

    it('bd/ at end of input gives error', () => {
      expect(() => parseMini('bd/')).toThrow('Invalid mini numeric postfix');
    });

    it('bd@ at end of input gives error', () => {
      expect(() => parseMini('bd@')).toThrow('Invalid mini numeric postfix');
    });

    it('nested unterminated group: [a [b gives correct error', () => {
      expect(() => parseMini('[a [b')).toThrow('Unterminated [ group in mini source');
    });

    it('mismatched brackets [a b> throws', () => {
      // The parser looks for ']' but finds '>', which is not whitespace/comma/etc.
      // '>' breaks the readToken loop, and then parseList keeps looking for ']'
      expect(() => parseMini('[a b>')).toThrow();
    });
  });

  // ── 26. Unicode input - extended ────────────────────────────────────
  describe('unicode input - extended', () => {
    it('emoji tokens have correct timing in a sequence', () => {
      const events = queryMini('\u{1F3B5} \u{1F941}', 0, 1);
      expect(events).toHaveLength(2);
      // Each occupies half the cycle
      const first = events.find((e) => e.begin === 0);
      const second = events.find((e) => e.begin === 0.5);
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(first?.end).toBeCloseTo(0.5, 10);
      expect(second?.end).toBeCloseTo(1, 10);
    });

    it('CJK characters work inside groups', () => {
      const events = showFirstCycle('[\u592A\u9F13 \u9227]');
      expect(events).toHaveLength(2);
      // showFirstCycle sorts alphabetically; just check both tokens appear
      const joined = events.join(' ');
      expect(joined).toContain('\u592A\u9F13');
      expect(joined).toContain('\u9227');
    });

    it('emoji with postfix operators', () => {
      const events = showFirstCycle('\u{1F941}*2');
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.includes('\u{1F941}'))).toBe(true);
    });

    it('multi-codepoint emoji as token name', () => {
      // Family emoji (multi-codepoint)
      const events = showFirstCycle('\u{1F468}\u200D\u{1F469}\u200D\u{1F467}');
      expect(events).toHaveLength(1);
    });

    it('Arabic script as token name', () => {
      const events = showFirstCycle('\u0637\u0628\u0644 \u062F\u0641');
      expect(events).toHaveLength(2);
    });

    it('Devanagari script as token name', () => {
      const events = showFirstCycle('\u0924\u092C\u0932\u093E');
      expect(events).toHaveLength(1);
      expect(events[0]).toContain('\u0924\u092C\u0932\u093E');
    });
  });

  // ── 27. Very long patterns - extended ───────────────────────────────
  describe('very long patterns - extended', () => {
    it('handles 500 items without crashing', () => {
      const pattern = Array.from({ length: 500 }, (_, i) => `s${i}`).join(' ');
      const events = showFirstCycle(pattern);
      expect(events).toHaveLength(500);
    });

    it('100 items in a group subdivide correctly', () => {
      const inner = Array.from({ length: 100 }, () => 'x').join(' ');
      const events = queryMini(`[${inner}]`, 0, 1);
      expect(events).toHaveLength(100);
      // Each event should span exactly 0.01
      for (const event of events) {
        expect(event.end - event.begin).toBeCloseTo(0.01, 10);
      }
    });

    it('100-element pattern with alternating rests', () => {
      const items = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 'a' : '~'));
      const pattern = items.join(' ');
      const events = showFirstCycle(pattern);
      // Only half should produce events (50 'a' tokens)
      expect(events).toHaveLength(50);
    });

    it('deeply nested groups (10 levels deep)', () => {
      let pattern = 'x';
      for (let i = 0; i < 10; i++) {
        pattern = `[${pattern}]`;
      }
      const events = showFirstCycle(pattern);
      expect(events).toEqual(['x: 0 - 1']);
    });

    it('wide and deep: 10 groups of 10 items each', () => {
      const groups = Array.from({ length: 10 }, () => {
        const inner = Array.from({ length: 10 }, (_, j) => `n${j}`).join(' ');
        return `[${inner}]`;
      });
      const events = showFirstCycle(groups.join(' '));
      expect(events).toHaveLength(100);
    });
  });

  // ── 28. Deeply nested Euclidean rhythms with rotation ───────────────
  describe('deeply nested euclidean rhythms with rotation', () => {
    it('bd(3,8,1) rotates the Bjorklund pattern by 1 step', () => {
      const unrotated = showFirstCycle('bd(3,8)');
      const rotated = showFirstCycle('bd(3,8,1)');
      expect(rotated).toHaveLength(3);
      expect(unrotated).toHaveLength(3);
      // The positions should differ
      expect(rotated).not.toEqual(unrotated);
      // Verify actual positions from the reference test
      expect(rotated).toEqual(['bd: 0.125 - 0.25', 'bd: 0.5 - 0.625', 'bd: 0.875 - 1']);
    });

    it('bd(3,8,2) rotates by 2 steps', () => {
      const rotated = showFirstCycle('bd(3,8,2)');
      expect(rotated).toHaveLength(3);
      // Should differ from both unrotated and rotation-1
      expect(rotated).not.toEqual(showFirstCycle('bd(3,8)'));
      expect(rotated).not.toEqual(showFirstCycle('bd(3,8,1)'));
    });

    it('euclidean rhythm inside a nested group with rotation', () => {
      const events = showFirstCycle('[bd(3,8,1) [hh hh]]');
      const bdEvents = events.filter((e) => e.startsWith('bd'));
      const hhEvents = events.filter((e) => e.startsWith('hh'));
      expect(bdEvents).toHaveLength(3);
      expect(hhEvents).toHaveLength(2);
    });

    it('multiple euclidean patterns with different rotations', () => {
      const events = showFirstCycle('bd(3,8,0) sd(2,5,1)');
      const bdEvents = events.filter((e) => e.startsWith('bd'));
      const sdEvents = events.filter((e) => e.startsWith('sd'));
      expect(bdEvents).toHaveLength(3);
      expect(sdEvents).toHaveLength(2);
    });

    it('euclidean with rotation equal to steps wraps to 0', () => {
      // bd(3,8,8) should equal bd(3,8,0) because 8 % 8 == 0
      expect(showFirstCycle('bd(3,8,8)')).toEqual(showFirstCycle('bd(3,8,0)'));
    });

    it('euclidean with large rotation value wraps correctly', () => {
      // bd(3,8,17) should equal bd(3,8,1) because 17 % 8 == 1
      expect(showFirstCycle('bd(3,8,17)')).toEqual(showFirstCycle('bd(3,8,1)'));
    });

    it('euclidean with negative rotation', () => {
      const events = showFirstCycle('bd(3,8,-1)');
      expect(events).toHaveLength(3);
      // -1 rotation is equivalent to rotating by 7 (since -1 % 8 + 8 = 7)
      expect(showFirstCycle('bd(3,8,-1)')).toEqual(showFirstCycle('bd(3,8,7)'));
    });

    it('euclidean with 1 pulse and rotation', () => {
      const events = showFirstCycle('bd(1,8,3)');
      expect(events).toHaveLength(1);
      // The single pulse should be at position 3 (out of 8 slots) after rotation
    });

    it('all pulses with rotation bd(8,8,3) still fills every slot', () => {
      const events = showFirstCycle('bd(8,8,3)');
      expect(events).toHaveLength(8);
      // Rotating a fully-filled pattern doesn't change the events
      expect(events).toEqual(showFirstCycle('bd(8,8,0)'));
    });
  });

  // ── 29. Top-level comma-separated stacks - extended ─────────────────
  describe('top-level comma-separated stacks - extended', () => {
    it('two items stacked: bd, sd both span full cycle', () => {
      const events = queryMini('bd, sd', 0, 1);
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.begin === 0 && e.end === 1)).toBe(true);
    });

    it('stack of sequences: [a b], [c d] produces 4 events', () => {
      const events = showFirstCycle('[a b], [c d]');
      expect(events).toHaveLength(4);
      // a and c both at [0, 0.5], b and d both at [0.5, 1]
      expect(events).toContain('a: 0 - 0.5');
      expect(events).toContain('b: 0.5 - 1');
      expect(events).toContain('c: 0 - 0.5');
      expect(events).toContain('d: 0.5 - 1');
    });

    it('three stacked items with different structures', () => {
      const events = showFirstCycle('bd, [hh hh], sd*2');
      const bdEvents = events.filter((e) => e.startsWith('bd'));
      const hhEvents = events.filter((e) => e.startsWith('hh'));
      const sdEvents = events.filter((e) => e.startsWith('sd'));
      expect(bdEvents).toHaveLength(1);
      expect(hhEvents).toHaveLength(2);
      expect(sdEvents).toHaveLength(2);
    });

    it('comma without spaces: a,b,c', () => {
      const events = showFirstCycle('a,b,c');
      expect(events).toHaveLength(3);
      expect(events.every((e) => e.includes('0 - 1'))).toBe(true);
    });

    it('stack inside group: [bd,sd hh] has 3 events', () => {
      const events = showFirstCycle('[bd,sd hh]');
      expect(events).toHaveLength(3);
      // bd and sd are stacked in the first half, hh in the second
      expect(events).toContain('bd: 0 - 0.5');
      expect(events).toContain('hh: 0.5 - 1');
      expect(events).toContain('sd: 0 - 0.5');
    });
  });

  // ── 30. Colon variants - extended ───────────────────────────────────
  describe('colon variants - extended', () => {
    it('bd:2 is treated as a single literal token', () => {
      const node = parseMini('bd:2');
      expect(node.kind).toBe('seq');
      if (node.kind === 'seq') {
        expect(node.items).toHaveLength(1);
        const item = node.items[0];
        expect(item?.kind).toBe('literal');
        if (item?.kind === 'literal') {
          expect(item.value).toBe('bd:2');
        }
      }
    });

    it('multiple colons: bd:2:hard is a single token', () => {
      const events = showFirstCycle('bd:2:hard');
      expect(events).toEqual(['bd:2:hard: 0 - 1']);
    });

    it('colon variant with postfix: bd:2*3 repeats the whole token', () => {
      const events = showFirstCycle('bd:2*3');
      expect(events).toHaveLength(3);
      expect(events.every((e) => e.startsWith('bd:2:'))).toBe(true);
    });

    it('colon variant in a group', () => {
      const events = showFirstCycle('[bd:0 bd:1 bd:2]');
      expect(events).toHaveLength(3);
      expect(events[0]).toContain('bd:0');
      expect(events[1]).toContain('bd:1');
      expect(events[2]).toContain('bd:2');
    });

    it('colon with numeric suffix does not confuse the parser', () => {
      const events = showFirstCycle('hh:3 sd:1');
      expect(events).toHaveLength(2);
      const values = events.map((e) => e.split(': ')[0]);
      expect(values).toContain('hh:3');
      expect(values).toContain('sd:1');
    });

    it('colon-prefixed group expands: bd:[0 1 2]', () => {
      const events = showFirstCycle('bd:[0 1 2]');
      expect(events).toHaveLength(3);
      // Each item gets the prefix
      expect(events[0]).toContain('bd:0');
      expect(events[1]).toContain('bd:1');
      expect(events[2]).toContain('bd:2');
    });

    it('colon-prefixed slowcat expands across cycles: sd:<a b>', () => {
      const c0 = queryMini('sd:<a b>', 0, 1);
      const c1 = queryMini('sd:<a b>', 1, 2);
      expect(c0[0]?.value).toBe('sd:a');
      expect(c1[0]?.value).toBe('sd:b');
    });
  });

  // ── 31. Decimal pattern weights (@) - extended ──────────────────────
  describe('decimal pattern weights @ - extended', () => {
    it('@0.25 gives a quarter weight', () => {
      const events = showFirstCycle('[a@0.25 b]');
      // a factor 0.25, b factor 1 => total 1.25
      // a occupies 0.25/1.25 = 0.2, b occupies 1/1.25 = 0.8
      expect(events).toHaveLength(2);
      expect(events).toContain('a: 0 - 0.2');
      expect(events).toContain('b: 0.2 - 1');
    });

    it('@0.1 gives a very small weight', () => {
      const events = queryMini('[a@0.1 b]', 0, 1);
      // a factor 0.1, b factor 1 => total 1.1
      // a occupies 0.1/1.1 ~ 0.0909..., b occupies 1/1.1 ~ 0.9090...
      expect(events).toHaveLength(2);
      const aEvent = events.find((e) => e.value === 'a');
      const bEvent = events.find((e) => e.value === 'b');
      expect(aEvent?.begin).toBeCloseTo(0, 10);
      expect(aEvent?.end).toBeCloseTo(0.1 / 1.1, 5);
      expect(bEvent?.begin).toBeCloseTo(0.1 / 1.1, 5);
      expect(bEvent?.end).toBeCloseTo(1, 10);
    });

    it('multiple items with decimal weights', () => {
      const events = showFirstCycle('[a@0.5 b@0.5 c]');
      // factors: 0.5, 0.5, 1 => total 2
      // a occupies 0.25, b occupies 0.25, c occupies 0.5
      expect(events).toHaveLength(3);
      expect(events).toContain('a: 0 - 0.25');
      expect(events).toContain('b: 0.25 - 0.5');
      expect(events).toContain('c: 0.5 - 1');
    });

    it('@3.5 gives a weight of 3.5', () => {
      const events = queryMini('[a@3.5 b]', 0, 1);
      // a factor 3.5, b factor 1 => total 4.5
      expect(events).toHaveLength(2);
      const aEvent = events.find((e) => e.value === 'a');
      expect(aEvent?.begin).toBeCloseTo(0, 10);
      expect(aEvent?.end).toBeCloseTo(3.5 / 4.5, 5);
    });

    it('@1 is a no-op stretch', () => {
      // @1 means factor becomes 1, which is the default
      expect(showFirstCycle('[a@1 b]')).toEqual(['a: 0 - 0.5', 'b: 0.5 - 1']);
    });

    it('stretch with division: a@2/3 combines both', () => {
      const events = showFirstCycle('[a@2/3 b]');
      // @2 sets factor to 2, then /3 multiplies by 3 => factor 6
      // a factor 6, b factor 1 => total 7
      const aEvent = events.find((e) => e.startsWith('a'));
      expect(aEvent).toBeDefined();
      expect(aEvent).toContain('a: 0 - 0.857143');
    });
  });

  // ── 32. queryMini boundary and range edge cases ─────────────────────
  describe('queryMini boundary and range edge cases', () => {
    it('querying a negative cycle range returns events', () => {
      const events = queryMini('a b', -1, 0);
      // Cycle -1: a spans [-1, -0.5], b spans [-0.5, 0]
      expect(events).toHaveLength(2);
    });

    it('querying across cycle boundaries captures all events', () => {
      const events = queryMini('a', 0, 3);
      // 'a' spans each full cycle, so 3 events
      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ begin: 0, end: 1, value: 'a' });
      expect(events[1]).toEqual({ begin: 1, end: 2, value: 'a' });
      expect(events[2]).toEqual({ begin: 2, end: 3, value: 'a' });
    });

    it('querying a very small range still finds events', () => {
      const events = queryMini('a b', 0.1, 0.2);
      // 'a' spans [0, 0.5] which overlaps [0.1, 0.2]
      expect(events).toHaveLength(1);
      expect(events[0]?.value).toBe('a');
    });

    it('querying exactly at event boundary', () => {
      const events = queryMini('a b', 0.5, 1);
      // 'b' spans [0.5, 1] which is exactly the query range
      expect(events).toHaveLength(1);
      expect(events[0]?.value).toBe('b');
    });
  });

  // ── 33. Interaction of multiple features ────────────────────────────
  describe('interaction of multiple features', () => {
    it('euclidean inside slowcat: <bd(3,8) sd>', () => {
      const c0 = queryMini('<bd(3,8) sd>', 0, 1);
      const c1 = queryMini('<bd(3,8) sd>', 1, 2);
      expect(c0.filter((e) => e.value === 'bd')).toHaveLength(3);
      expect(c0.filter((e) => e.value === 'sd')).toHaveLength(0);
      expect(c1.filter((e) => e.value === 'sd')).toHaveLength(1);
      expect(c1.filter((e) => e.value === 'bd')).toHaveLength(0);
    });

    it('stacked groups with euclidean: [bd(3,8), hh*4]', () => {
      const events = showFirstCycle('[bd(3,8), hh*4]');
      expect(events.filter((e) => e.startsWith('bd'))).toHaveLength(3);
      expect(events.filter((e) => e.startsWith('hh'))).toHaveLength(4);
    });

    it('division with stretch: [a/2 b@2]', () => {
      const events = showFirstCycle('[a/2 b@2]');
      // a factor = 1*2 = 2, b factor = 1*2 = 2 (stretch sets factor)
      // total = 4, each gets 0.5
      // Wait: a has factor 2 from /2, b has factor 2 from @2 => total 4
      // a occupies 2/4 = 0.5, b occupies 2/4 = 0.5
      expect(events).toHaveLength(2);
    });

    it('rest with multiple operators: ~@3/2', () => {
      const events = showFirstCycle('[~@3/2 a]');
      // @3 sets factor to 3, /2 multiplies by 2 => factor 6
      // rest factor 6, a factor 1 => total 7
      // a occupies 1/7 of the cycle at the end
      expect(events).toHaveLength(1);
      const aEvent = events[0];
      expect(aEvent).toContain('a:');
      expect(aEvent).toContain('- 1');
    });

    it('prefix group with euclidean: bd:[0 1 2] combined with euclidean elsewhere', () => {
      const events = showFirstCycle('bd:[0 1 2] sd(2,3)');
      expect(events.filter((e) => e.startsWith('bd'))).toHaveLength(3);
      expect(events.filter((e) => e.startsWith('sd'))).toHaveLength(2);
    });
  });

  // ── 34. parseMini AST structure verification ────────────────────────
  describe('parseMini AST structure verification', () => {
    it('simple sequence produces seq with literal items', () => {
      const node = parseMini('a b c');
      expect(node.kind).toBe('seq');
      if (node.kind === 'seq') {
        expect(node.items).toHaveLength(3);
        expect(node.items.every((item) => item.kind === 'literal')).toBe(true);
      }
    });

    it('repeat operator produces repeat node', () => {
      const node = parseMini('bd*3');
      expect(node.kind).toBe('seq');
      if (node.kind === 'seq') {
        expect(node.items).toHaveLength(1);
        const item = node.items[0];
        expect(item?.kind).toBe('repeat');
        if (item?.kind === 'repeat') {
          expect(item.count).toBe(3);
          expect(item.node.kind).toBe('literal');
        }
      }
    });

    it('division sets factor on the node', () => {
      const node = parseMini('bd/2');
      expect(node.kind).toBe('seq');
      if (node.kind === 'seq') {
        const item = node.items[0];
        expect(item?.factor).toBe(2);
        expect(item?.kind).toBe('literal');
      }
    });

    it('stretch operator produces stretch node', () => {
      const node = parseMini('bd@2');
      expect(node.kind).toBe('seq');
      if (node.kind === 'seq') {
        const item = node.items[0];
        expect(item?.kind).toBe('stretch');
        if (item?.kind === 'stretch') {
          expect(item.factor).toBe(2);
        }
      }
    });

    it('stack from comma produces stack node', () => {
      const node = parseMini('a,b');
      expect(node.kind).toBe('seq');
      if (node.kind === 'seq') {
        expect(node.items).toHaveLength(1);
        const item = node.items[0];
        expect(item?.kind).toBe('stack');
        if (item?.kind === 'stack') {
          expect(item.items).toHaveLength(2);
        }
      }
    });

    it('rest ~ produces rest node', () => {
      const node = parseMini('~');
      expect(node.kind).toBe('seq');
      if (node.kind === 'seq') {
        expect(node.items[0]?.kind).toBe('rest');
      }
    });

    it('- also produces rest node', () => {
      const node = parseMini('-');
      expect(node.kind).toBe('seq');
      if (node.kind === 'seq') {
        expect(node.items[0]?.kind).toBe('rest');
      }
    });
  });

  // ── Audit edge cases (F.01–F.11) ─────────────────────────────────────
  describe('audit edge cases (F.01-F.11)', () => {
    // F.01: Deep nesting (10+ levels)
    it('F.01 — deep nesting (10+ levels) parses without stack overflow', () => {
      const events = showFirstCycle('[[[[[[[[[[bd]]]]]]]]]]');
      expect(events).toEqual(['bd: 0 - 1']);
    });

    it('F.01 — deep nesting (12 levels) with two leaves', () => {
      const pattern = '['.repeat(12) + 'a b' + ']'.repeat(12);
      const events = showFirstCycle(pattern);
      expect(events).toEqual(['a: 0 - 0.5', 'b: 0.5 - 1']);
    });

    // F.02: Multiplication by non-integers
    it('F.02 — bd*2.5 produces three events covering the cycle', () => {
      const events = showFirstCycle('bd*2.5');
      expect(events).toHaveLength(3);
      // Each slot is 1/2.5 = 0.4 wide; third event bleeds past cycle end
      expect(events[0]).toBe('bd: 0 - 0.4');
      expect(events[1]).toBe('bd: 0.4 - 0.8');
      expect(events[2]).toMatch(/^bd: 0\.8 - 1\.2/);
    });

    it('F.02 — bd*1.5 produces two events', () => {
      const events = showFirstCycle('bd*1.5');
      expect(events).toHaveLength(2);
      expect(events[0]).toBe('bd: 0 - 0.666667');
      expect(events[1]).toMatch(/^bd: 0\.666667/);
    });

    // F.03: Empty input
    it('F.03 — queryMini("", 0, 1) returns an empty array', () => {
      const events = queryMini('', 0, 1);
      expect(events).toEqual([]);
    });

    it('F.03 — showFirstCycle("") returns an empty array', () => {
      expect(showFirstCycle('')).toEqual([]);
    });

    it('F.03 — inferMiniSteps("") returns 0', () => {
      expect(inferMiniSteps('')).toBe(0);
    });

    // F.04: Malformed input
    it('F.04 — unclosed bracket "[bd" throws', () => {
      expect(() => showFirstCycle('[bd')).toThrow('Unterminated [ group in mini source');
    });

    it('F.04 — unclosed angle bracket "<bd" throws', () => {
      expect(() => showFirstCycle('<bd')).toThrow('Unterminated < group in mini source');
    });

    it('F.04 — mismatched parens "bd(3,8" does not crash (parens are not group delimiters)', () => {
      // Parens are only consumed by the euclidean regex in preprocessing.
      // An incomplete paren pattern falls through as literal token characters.
      const events = showFirstCycle('bd(3,8');
      expect(events).toBeDefined();
      expect(Array.isArray(events)).toBe(true);
      // The comma splits into a stack; "bd(3" and "8" become literals
      expect(events).toHaveLength(2);
    });

    // F.05: Unicode input
    it('F.05 — unicode emoji "🎵" parses as a literal', () => {
      const events = showFirstCycle('🎵');
      expect(events).toEqual(['🎵: 0 - 1']);
    });

    it('F.05 — unicode characters in a sequence', () => {
      const events = showFirstCycle('🥁 🎹');
      expect(events).toHaveLength(2);
      expect(events).toEqual(['🎹: 0.5 - 1', '🥁: 0 - 0.5']);
    });

    // F.06: Very long patterns (100+ elements)
    it('F.06 — 100-element pattern parses correctly', () => {
      const tokens = Array.from({ length: 100 }, (_, index) => `x${index}`);
      const pattern = tokens.join(' ');
      const events = showFirstCycle(pattern);
      expect(events).toHaveLength(100);
      // Each element occupies 1/100 of the cycle
      const width = 1 / 100;
      // Check first and last events
      expect(events).toContain(`x0: 0 - ${Number(width.toFixed(6))}`);
      expect(events).toContain(`x99: ${Number((99 * width).toFixed(6))} - 1`);
    });

    it('F.06 — 200-element pattern parses without error', () => {
      const tokens = Array.from({ length: 200 }, (_, index) => `s${index}`);
      const pattern = tokens.join(' ');
      const events = showFirstCycle(pattern);
      expect(events).toHaveLength(200);
    });

    // F.09: Top-level comma-separated stacks
    it('F.09 — "bd, sd, hh" produces 3 simultaneous events', () => {
      const events = showFirstCycle('bd, sd, hh');
      expect(events).toHaveLength(3);
      expect(events).toEqual(['bd: 0 - 1', 'hh: 0 - 1', 'sd: 0 - 1']);
    });

    it('F.09 — "a, b" produces 2 simultaneous events spanning full cycle', () => {
      const events = showFirstCycle('a, b');
      expect(events).toEqual(['a: 0 - 1', 'b: 0 - 1']);
    });

    it('F.09 — parseMini("bd, sd, hh") produces a stack node with 3 items', () => {
      const node = parseMini('bd, sd, hh');
      expect(node.kind).toBe('seq');
      if (node.kind === 'seq') {
        expect(node.items).toHaveLength(1);
        const stack = node.items[0];
        expect(stack?.kind).toBe('stack');
        if (stack?.kind === 'stack') {
          expect(stack.items).toHaveLength(3);
        }
      }
    });

    // F.10: Colon variants
    it('F.10 — "bd:2" sets value to "bd:2"', () => {
      const events = showFirstCycle('bd:2');
      expect(events).toEqual(['bd:2: 0 - 1']);
    });

    it('F.10 — "hh:open" sets value to "hh:open"', () => {
      const events = showFirstCycle('hh:open');
      expect(events).toEqual(['hh:open: 0 - 1']);
    });

    it('F.10 — colon variant inside a group "[bd:0 sd:1]"', () => {
      const events = showFirstCycle('[bd:0 sd:1]');
      expect(events).toEqual(['bd:0: 0 - 0.5', 'sd:1: 0.5 - 1']);
    });

    // F.11: Decimal pattern weights (multiplication / division with decimals)
    it('F.11 — bd*0.5 stretches the event to 2x normal width', () => {
      // *0.5 means repeat 0.5 times, which creates a single event spanning 1/0.5 = 2 units
      const events = showFirstCycle('bd*0.5');
      expect(events).toHaveLength(1);
      expect(events[0]).toBe('bd: 0 - 2');
    });

    it('F.11 — bd/1.5 sets factor to 1.5', () => {
      const events = showFirstCycle('bd/1.5 sd');
      // bd has factor 1.5, sd has factor 1 => total 2.5
      // bd occupies 1.5/2.5 = 0.6, sd occupies 1/2.5 = 0.4
      expect(events).toEqual(['bd: 0 - 0.6', 'sd: 0.6 - 1']);
    });

    it('F.11 — decimal multiplier interacts correctly with groups', () => {
      const events = showFirstCycle('[a b]*1.5');
      // *1.5 on a group: repeat 1.5 times -> a, b, a (three events)
      expect(events).toHaveLength(3);
      expect(events).toEqual(['a: 0 - 0.333333', 'a: 0.666667 - 1', 'b: 0.333333 - 0.666667']);
    });
  });

  // ── 35. Multiplication by non-integers (extended) ──────────────────
  describe('multiplication by non-integers (extended)', () => {
    it('a*0.25 produces 1 event spanning 4x the cycle', () => {
      // repeat count 0.25: width = 1/0.25 = 4. Loop: i=0 < 0.25 is false? No.
      // 0 < 0.25 is true so 1 iteration. Event spans [0, 4].
      const events = showFirstCycle('a*0.25');
      expect(events).toHaveLength(1);
      expect(events[0]).toBe('a: 0 - 4');
    });

    it('a*0.5 produces 1 event spanning 2x the cycle', () => {
      const events = showFirstCycle('a*0.5');
      expect(events).toHaveLength(1);
      expect(events[0]).toBe('a: 0 - 2');
    });

    it('a*1.5 inside a group produces correct subdivision', () => {
      const events = queryMini('[a*1.5 b]', 0, 1);
      // a*1.5 occupies half the group, b occupies the other half
      // Within a's half, *1.5 repeats: 2 iterations of width (0.5/1.5)
      const aEvents = events.filter((e) => e.value === 'a');
      expect(aEvents).toHaveLength(2);
      expect(events.filter((e) => e.value === 'b')).toHaveLength(1);
    });

    it('a*3.7 produces 4 events (floor(3.7)+1 iterations)', () => {
      const events = queryMini('a*3.7', 0, 1);
      // Loop: i=0,1,2,3 (3 < 3.7 is true), so 4 iterations
      expect(events).toHaveLength(4);
      const width = 1 / 3.7;
      for (let i = 0; i < 4; i++) {
        expect(events[i]?.begin).toBeCloseTo(width * i, 5);
        expect(events[i]?.end).toBeCloseTo(width * (i + 1), 5);
      }
    });

    it('[a b c]*0.5 produces only partial group (2 of 3 items)', () => {
      // *0.5: width per group = 1/0.5 = 2. Loop: i=0 < 0.5 is false? No.
      // 0 < 0.5 is true, so 1 iteration. The group [a b c] spans [0, 2].
      // Within [0,1] query we see a at [0, 2/3] and b at [2/3, 4/3].
      const events = queryMini('[a b c]*0.5', 0, 1);
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.some((e) => e.value === 'a')).toBe(true);
      expect(events.some((e) => e.value === 'b')).toBe(true);
    });

    it('a*1.5/2.5 chains fractional multiply and divide', () => {
      // *1.5 creates repeat(count=1.5), then /2.5 multiplies factor by 2.5
      const events = showFirstCycle('a*1.5/2.5 b');
      const aEvents = events.filter((e) => e.startsWith('a'));
      const bEvents = events.filter((e) => e.startsWith('b'));
      expect(aEvents).toHaveLength(2);
      expect(bEvents).toHaveLength(1);
    });
  });

  // ── 36. Unicode input (Greek, CJK, mixed) ─────────────────────────
  describe('unicode input (Greek, CJK, mixed)', () => {
    it('Greek letters α β γ parse as three tokens', () => {
      const events = showFirstCycle('α β γ');
      expect(events).toHaveLength(3);
      expect(events).toEqual(['α: 0 - 0.333333', 'β: 0.333333 - 0.666667', 'γ: 0.666667 - 1']);
    });

    it('Japanese characters 日 本 parse as two tokens', () => {
      const events = showFirstCycle('日 本');
      expect(events).toHaveLength(2);
      expect(events).toEqual(['日: 0 - 0.5', '本: 0.5 - 1']);
    });

    it('Greek letters work inside groups', () => {
      const events = showFirstCycle('[α β γ]');
      expect(events).toHaveLength(3);
      expect(events[0]).toContain('α');
      expect(events[1]).toContain('β');
      expect(events[2]).toContain('γ');
    });

    it('Japanese characters work inside groups', () => {
      const events = showFirstCycle('[日 本 語]');
      expect(events).toHaveLength(3);
      expect(events[0]).toContain('日');
      expect(events[1]).toContain('本');
      expect(events[2]).toContain('語');
    });

    it('Greek letters with postfix operators', () => {
      const events = showFirstCycle('α*2 β');
      expect(events).toHaveLength(3);
      expect(events.filter((e) => e.includes('α'))).toHaveLength(2);
      expect(events.filter((e) => e.includes('β'))).toHaveLength(1);
    });

    it('CJK characters with division postfix', () => {
      const events = showFirstCycle('日/2 本');
      // 日 has factor 2, 本 has factor 1 => total 3
      expect(events).toHaveLength(2);
      expect(events[0]).toBe('日: 0 - 0.666667');
      expect(events[1]).toBe('本: 0.666667 - 1');
    });

    it('mixed ASCII and Greek in sequence', () => {
      const events = showFirstCycle('bd α sd β');
      expect(events).toHaveLength(4);
      const values = events.map((e) => e.split(':')[0]);
      expect(values).toContain('bd');
      expect(values).toContain('α');
      expect(values).toContain('sd');
      expect(values).toContain('β');
    });

    it('unicode tokens in slowcat alternate across cycles', () => {
      const c0 = queryMini('<α β>', 0, 1);
      const c1 = queryMini('<α β>', 1, 2);
      expect(c0[0]?.value).toBe('α');
      expect(c1[0]?.value).toBe('β');
    });

    it('unicode tokens in stacked groups', () => {
      const events = showFirstCycle('α,β');
      expect(events).toHaveLength(2);
      expect(events).toEqual(['α: 0 - 1', 'β: 0 - 1']);
    });
  });

  // ── 37. Very long patterns (200+ items, stress tests) ─────────────
  describe('very long patterns (200+ items, stress tests)', () => {
    it('300 items parse correctly', () => {
      const pattern = Array.from({ length: 300 }, (_, i) => `n${i}`).join(' ');
      expect(showFirstCycle(pattern)).toHaveLength(300);
    });

    it('1000 items parse without crashing', () => {
      const pattern = Array.from({ length: 1000 }, (_, i) => `t${i}`).join(' ');
      expect(showFirstCycle(pattern)).toHaveLength(1000);
    });

    it('200 items each with postfix *2 produce 400 events', () => {
      const pattern = Array.from({ length: 200 }, (_, i) => `x${i}*2`).join(' ');
      const events = queryMini(pattern, 0, 1);
      expect(events).toHaveLength(400);
    });

    it('200 items with alternating rests produce 100 events', () => {
      const items = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 'a' : '~'));
      const events = showFirstCycle(items.join(' '));
      expect(events).toHaveLength(100);
    });

    it('50 groups of 5 items each produce 250 events', () => {
      const groups = Array.from({ length: 50 }, () => {
        const inner = Array.from({ length: 5 }, (_, j) => `s${j}`).join(' ');
        return `[${inner}]`;
      });
      const events = showFirstCycle(groups.join(' '));
      expect(events).toHaveLength(250);
    });

    it('inferMiniSteps on 200+ items returns correct count', () => {
      const pattern = Array.from({ length: 250 }, (_, i) => `n${i}`).join(' ');
      expect(inferMiniSteps(pattern)).toBe(250);
    });
  });

  // ── 38. Deeply nested Euclidean rhythms ────────────────────────────
  describe('deeply nested Euclidean rhythms', () => {
    it('[a(3,8) [b(5,13) c(7,16)]] produces correct hit counts', () => {
      const events = showFirstCycle('[a(3,8) [b(5,13) c(7,16)]]');
      const aEvents = events.filter((e) => e.startsWith('a'));
      const bEvents = events.filter((e) => e.startsWith('b'));
      const cEvents = events.filter((e) => e.startsWith('c'));
      // a(3,8) = 3 hits, b(5,13) = 5 hits, c(7,16) = 7 hits
      expect(aEvents).toHaveLength(3);
      expect(bEvents).toHaveLength(5);
      expect(cEvents).toHaveLength(7);
      // Total events = 3 + 5 + 7 = 15
      expect(events).toHaveLength(15);
    });

    it('[a(3,8) [b(5,13) c(7,16)]] a events occupy first half of cycle', () => {
      const events = queryMini('[a(3,8) [b(5,13) c(7,16)]]', 0, 1);
      const aEvents = events.filter((e) => e.value === 'a');
      // The top-level group has 2 items: a(3,8) and [b(5,13) c(7,16)]
      // Each gets half the cycle. a events should be in [0, 0.5].
      for (const event of aEvents) {
        expect(event.begin).toBeGreaterThanOrEqual(0);
        expect(event.end).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    });

    it('[a(3,8) [b(5,13) c(7,16)]] b and c events occupy second half', () => {
      const events = queryMini('[a(3,8) [b(5,13) c(7,16)]]', 0, 1);
      const bcEvents = events.filter((e) => e.value === 'b' || e.value === 'c');
      for (const event of bcEvents) {
        expect(event.begin).toBeGreaterThanOrEqual(0.5 - 1e-9);
        expect(event.end).toBeLessThanOrEqual(1 + 1e-9);
      }
    });

    it('euclidean inside a deeply nested group: [[a(2,3)] b]', () => {
      const events = showFirstCycle('[[a(2,3)] b]');
      const aEvents = events.filter((e) => e.startsWith('a'));
      expect(aEvents).toHaveLength(2);
      expect(events.filter((e) => e.startsWith('b'))).toHaveLength(1);
    });

    it('three-level deep euclidean: [[[a(3,5)]]]', () => {
      const events = showFirstCycle('[[[a(3,5)]]]');
      expect(events.filter((e) => e.startsWith('a'))).toHaveLength(3);
    });

    it('euclidean with rotation inside nested group', () => {
      const events = showFirstCycle('[a(3,8,2) [b(2,5,1)]]');
      expect(events.filter((e) => e.startsWith('a'))).toHaveLength(3);
      expect(events.filter((e) => e.startsWith('b'))).toHaveLength(2);
    });

    it('stacked euclidean patterns in nested groups: [[a(3,8), b(5,8)]]', () => {
      const events = showFirstCycle('[[a(3,8), b(5,8)]]');
      expect(events.filter((e) => e.startsWith('a'))).toHaveLength(3);
      expect(events.filter((e) => e.startsWith('b'))).toHaveLength(5);
    });
  });

  // ── 39. Decimal pattern weights (extended) ─────────────────────────
  describe('decimal pattern weights (extended)', () => {
    it('three items with all decimal weights: [a@0.3 b@0.5 c@0.2]', () => {
      const events = queryMini('[a@0.3 b@0.5 c@0.2]', 0, 1);
      // total factor = 0.3 + 0.5 + 0.2 = 1.0
      // a occupies 0.3, b occupies 0.5, c occupies 0.2
      expect(events).toHaveLength(3);
      const aEvent = events.find((e) => e.value === 'a');
      const bEvent = events.find((e) => e.value === 'b');
      const cEvent = events.find((e) => e.value === 'c');
      expect(aEvent?.begin).toBeCloseTo(0, 10);
      expect(aEvent?.end).toBeCloseTo(0.3, 5);
      expect(bEvent?.begin).toBeCloseTo(0.3, 5);
      expect(bEvent?.end).toBeCloseTo(0.8, 5);
      expect(cEvent?.begin).toBeCloseTo(0.8, 5);
      expect(cEvent?.end).toBeCloseTo(1, 5);
    });

    it('@0.01 gives a very tiny weight', () => {
      const events = queryMini('[a@0.01 b]', 0, 1);
      expect(events).toHaveLength(2);
      const aEvent = events.find((e) => e.value === 'a');
      // a factor 0.01, b factor 1 => total 1.01
      // a occupies 0.01/1.01 ≈ 0.0099
      expect(aEvent?.end).toBeCloseTo(0.01 / 1.01, 4);
    });

    it('@10 gives 10x weight relative to normal items', () => {
      const events = queryMini('[a@10 b]', 0, 1);
      // a factor 10, b factor 1 => total 11
      const aEvent = events.find((e) => e.value === 'a');
      expect(aEvent?.end).toBeCloseTo(10 / 11, 5);
    });

    it('decimal weight combined with repeat: a@0.5*2 in a group', () => {
      const events = queryMini('[a@0.5*2 b]', 0, 1);
      // @0.5 creates stretch with factor 0.5, then *2 repeats
      const aEvents = events.filter((e) => e.value === 'a');
      expect(aEvents).toHaveLength(2);
    });

    it('equal decimal weights produce equal spacing', () => {
      const events = queryMini('[a@0.5 b@0.5]', 0, 1);
      expect(events).toHaveLength(2);
      const aEvent = events.find((e) => e.value === 'a');
      const bEvent = events.find((e) => e.value === 'b');
      expect(aEvent?.begin).toBeCloseTo(0, 10);
      expect(aEvent?.end).toBeCloseTo(0.5, 10);
      expect(bEvent?.begin).toBeCloseTo(0.5, 10);
      expect(bEvent?.end).toBeCloseTo(1, 10);
    });
  });

  // ── 40. Numeric postfix validation edge cases ──────────────────────
  describe('numeric postfix validation edge cases', () => {
    it('a*0 throws "Invalid mini numeric postfix"', () => {
      expect(() => parseMini('a*0')).toThrow('Invalid mini numeric postfix "0"');
    });

    it('a!0 throws "Invalid mini numeric postfix"', () => {
      expect(() => parseMini('a!0')).toThrow('Invalid mini numeric postfix "0"');
    });

    it('a@0 throws "Invalid mini numeric postfix"', () => {
      expect(() => parseMini('a@0')).toThrow('Invalid mini numeric postfix "0"');
    });

    it('a/0 throws "Invalid mini numeric postfix"', () => {
      expect(() => parseMini('a/0')).toThrow('Invalid mini numeric postfix "0"');
    });

    it('a*-1 throws (readNumber cannot parse negative sign)', () => {
      // readNumber reads only digits and dots; "-" is not consumed,
      // leaving raw = "" which is NaN, triggering the error
      expect(() => parseMini('a*-1')).toThrow('Invalid mini numeric postfix');
    });

    it('a/-1 throws (same readNumber issue)', () => {
      expect(() => parseMini('a/-1')).toThrow('Invalid mini numeric postfix');
    });

    it('a!-1 throws (same readNumber issue)', () => {
      expect(() => parseMini('a!-1')).toThrow('Invalid mini numeric postfix');
    });

    it('a@-1 throws (same readNumber issue)', () => {
      expect(() => parseMini('a@-1')).toThrow('Invalid mini numeric postfix');
    });

    it('a*1 is valid and equivalent to a single event', () => {
      expect(showFirstCycle('a*1')).toEqual(['a: 0 - 1']);
    });

    it('a!1 is valid and equivalent to a single event', () => {
      expect(showFirstCycle('a!1')).toEqual(['a: 0 - 1']);
    });

    it('a@1 is valid (stretch factor 1, no-op)', () => {
      expect(showFirstCycle('[a@1 b]')).toEqual(['a: 0 - 0.5', 'b: 0.5 - 1']);
    });

    it('a/1 is valid (factor stays 1)', () => {
      expect(showFirstCycle('a/1 b')).toEqual(['a: 0 - 0.5', 'b: 0.5 - 1']);
    });

    it('a*abc throws (non-numeric postfix)', () => {
      expect(() => parseMini('a*abc')).toThrow('Invalid mini numeric postfix');
    });

    it('a* at end of input throws', () => {
      expect(() => parseMini('a*')).toThrow('Invalid mini numeric postfix');
    });

    it('thrown errors are instances of TusselParseError', () => {
      try {
        parseMini('a*0');
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TusselParseError);
      }
    });
  });

  // ── 41. Mixed rest and literal patterns ────────────────────────────
  describe('mixed rest and literal patterns', () => {
    it('alternating rest-literal pattern: [~ a ~ b ~ c]', () => {
      const events = showFirstCycle('[~ a ~ b ~ c]');
      expect(events).toHaveLength(3);
      expect(events).toEqual(['a: 0.166667 - 0.333333', 'b: 0.5 - 0.666667', 'c: 0.833333 - 1']);
    });

    it('rests at start and end: [~ ~ a ~ ~]', () => {
      const events = showFirstCycle('[~ ~ a ~ ~]');
      expect(events).toHaveLength(1);
      expect(events[0]).toBe('a: 0.4 - 0.6');
    });

    it('mixed - and ~ rest symbols: a - b ~ c - d', () => {
      const events = showFirstCycle('a - b ~ c - d');
      expect(events).toHaveLength(4);
      expect(events).toEqual([
        'a: 0 - 0.142857',
        'b: 0.285714 - 0.428571',
        'c: 0.571429 - 0.714286',
        'd: 0.857143 - 1',
      ]);
    });

    it('mostly rests with one literal: [~ ~ ~ ~ a]', () => {
      const events = showFirstCycle('[~ ~ ~ ~ a]');
      expect(events).toHaveLength(1);
      expect(events[0]).toBe('a: 0.8 - 1');
    });

    it('rest with stretch in mixed pattern: [~@2 a ~@3 b]', () => {
      const events = queryMini('[~@2 a ~@3 b]', 0, 1);
      // rest1 factor 2, a factor 1, rest2 factor 3, b factor 1 => total 7
      expect(events).toHaveLength(2);
      const aEvent = events.find((e) => e.value === 'a');
      const bEvent = events.find((e) => e.value === 'b');
      expect(aEvent?.begin).toBeCloseTo(2 / 7, 5);
      expect(aEvent?.end).toBeCloseTo(3 / 7, 5);
      expect(bEvent?.begin).toBeCloseTo(6 / 7, 5);
      expect(bEvent?.end).toBeCloseTo(1, 5);
    });

    it('rest with repeat: ~*3 produces silence (no events)', () => {
      const events = showFirstCycle('~*3');
      expect(events).toEqual([]);
    });

    it('rests preserve spacing between literal events: a ~ ~ ~ b', () => {
      const events = showFirstCycle('a ~ ~ ~ b');
      expect(events).toHaveLength(2);
      expect(events[0]).toBe('a: 0 - 0.2');
      expect(events[1]).toBe('b: 0.8 - 1');
    });

    it('- rest with repeat: -*2 a produces 1 event', () => {
      const events = showFirstCycle('[-*2 a]');
      // rest*2 occupies 1 slot but repeats the rest 2x; a occupies 1 slot
      // rest produces no events, a starts at 0.5
      expect(events).toHaveLength(1);
      expect(events[0]).toContain('a');
    });
  });

  // ── 42. Empty groups [] and <> ─────────────────────────────────────
  describe('empty groups [] and <>', () => {
    it('[] produces no events', () => {
      expect(showFirstCycle('[]')).toEqual([]);
    });

    it('<> produces no events', () => {
      expect(showFirstCycle('<>')).toEqual([]);
    });

    it('parseMini([]) produces a group node with no items', () => {
      const node = parseMini('[]');
      expect(node.kind).toBe('seq');
      if (node.kind === 'seq') {
        expect(node.items).toHaveLength(1);
        const group = node.items[0];
        expect(group?.kind).toBe('group');
        if (group?.kind === 'group') {
          expect(group.items).toEqual([]);
        }
      }
    });

    it('parseMini(<>) produces a slowcat node with no items', () => {
      const node = parseMini('<>');
      expect(node.kind).toBe('seq');
      if (node.kind === 'seq') {
        expect(node.items).toHaveLength(1);
        const slowcat = node.items[0];
        expect(slowcat?.kind).toBe('slowcat');
        if (slowcat?.kind === 'slowcat') {
          expect(slowcat.items).toEqual([]);
        }
      }
    });

    it('queryMini(<>, 0, 3) produces no events across multiple cycles', () => {
      expect(queryMini('<>', 0, 3)).toEqual([]);
    });

    it('empty group inside a sequence: [[] a] produces only a', () => {
      const events = showFirstCycle('[[] a]');
      // [] is an empty group occupying one slot, a occupies another
      // [] produces no events, but takes space
      expect(events).toHaveLength(1);
      expect(events[0]).toBe('a: 0.5 - 1');
    });

    it('empty group between items: [a [] b]', () => {
      const events = showFirstCycle('[a [] b]');
      // 3 items: a, [], b — each gets 1/3 of the cycle
      // [] produces no events
      expect(events).toHaveLength(2);
      expect(events).toEqual(['a: 0 - 0.333333', 'b: 0.666667 - 1']);
    });

    it('inferMiniSteps for [] returns 1 (the empty group counts as 1 seq item)', () => {
      expect(inferMiniSteps('[]')).toBe(1);
    });

    it('inferMiniSteps for <> returns 1', () => {
      expect(inferMiniSteps('<>')).toBe(1);
    });
  });

  // ── 43. Single-item groups [a] and <a> ─────────────────────────────
  describe('single-item groups [a] and <a>', () => {
    it('[a] produces the same output as bare a', () => {
      expect(showFirstCycle('[a]')).toEqual(showFirstCycle('a'));
    });

    it('<a> produces the same output as bare a for cycle 0', () => {
      expect(showFirstCycle('<a>')).toEqual(showFirstCycle('a'));
    });

    it('[a] parseMini produces group with one literal item', () => {
      const node = parseMini('[a]');
      expect(node.kind).toBe('seq');
      if (node.kind === 'seq') {
        expect(node.items).toHaveLength(1);
        const group = node.items[0];
        expect(group?.kind).toBe('group');
        if (group?.kind === 'group') {
          expect(group.items).toHaveLength(1);
          expect(group.items[0]?.kind).toBe('literal');
        }
      }
    });

    it('<a> repeats the same item across multiple cycles', () => {
      const events = queryMini('<a>', 0, 3);
      expect(events).toHaveLength(3);
      expect(events.every((e) => e.value === 'a')).toBe(true);
    });

    it('[a] with postfix: [a]*2 doubles the event', () => {
      const events = showFirstCycle('[a]*2');
      expect(events).toHaveLength(2);
      expect(events).toEqual(['a: 0 - 0.5', 'a: 0.5 - 1']);
    });

    it('single-item group in a sequence: [a] b c', () => {
      const events = showFirstCycle('[a] b c');
      expect(events).toHaveLength(3);
      expect(events).toEqual(['a: 0 - 0.333333', 'b: 0.333333 - 0.666667', 'c: 0.666667 - 1']);
    });

    it('nested single-item groups: [[a]]', () => {
      expect(showFirstCycle('[[a]]')).toEqual(['a: 0 - 1']);
    });

    it('inferMiniSteps for [a] returns 1', () => {
      expect(inferMiniSteps('[a]')).toBe(1);
    });

    it('inferMiniSteps for <a> returns 1', () => {
      expect(inferMiniSteps('<a>')).toBe(1);
    });
  });

  // ── 44. Patterns with only whitespace ──────────────────────────────
  describe('patterns with only whitespace', () => {
    it('single space returns empty', () => {
      expect(showFirstCycle(' ')).toEqual([]);
    });

    it('multiple spaces return empty', () => {
      expect(showFirstCycle('     ')).toEqual([]);
    });

    it('tab characters return empty', () => {
      expect(showFirstCycle('\t\t\t')).toEqual([]);
    });

    it('newline characters return empty', () => {
      expect(showFirstCycle('\n\n\n')).toEqual([]);
    });

    it('carriage return + newline returns empty', () => {
      expect(showFirstCycle('\r\n\r\n')).toEqual([]);
    });

    it('mixed whitespace (spaces, tabs, newlines) returns empty', () => {
      expect(showFirstCycle('  \t  \n  \t\n  ')).toEqual([]);
    });

    it('parseMini on whitespace returns seq with no items', () => {
      expect(parseMini('  \t\n  ')).toEqual({ kind: 'seq', items: [], factor: 1 });
    });

    it('inferMiniSteps on whitespace returns 0', () => {
      expect(inferMiniSteps('  \t\n  ')).toBe(0);
    });

    it('queryMini on whitespace returns empty', () => {
      expect(queryMini('  \t  ', 0, 1)).toEqual([]);
    });

    it('whitespace between tokens is handled normally', () => {
      // Extra whitespace should not create empty tokens
      expect(showFirstCycle('  a   b   c  ')).toEqual([
        'a: 0 - 0.333333',
        'b: 0.333333 - 0.666667',
        'c: 0.666667 - 1',
      ]);
    });
  });
});
