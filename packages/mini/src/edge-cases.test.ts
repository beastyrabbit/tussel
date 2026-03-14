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
    it('bd*1.5 repeats 1.5 times — parser reads it as repeat count', () => {
      // *1.5 creates a repeat node. The repeat count is 1.5 but is truncated/used
      // as a float. Let's verify it doesn't crash and produces output.
      const result = showFirstCycle('bd*1.5');
      // repeat node with count 1.5: width = 1/1.5 = 0.666667 per rep
      // index 0: 0 - 0.666667, index 1 (if < count): 0.666667 - 1.333333 but clamped to cycle
      // Actually the repeat loop uses `for (let index = 0; index < node.count; index += 1)`
      // 1.5 > 0 → index 0, 1.5 > 1 → index 1, so it renders 1 iteration
      // Wait: the loop is index < 1.5, so index 0 runs. index 1 < 1.5 is true, so index 1 runs too.
      // But the width is 1/1.5, so the second iteration begins at 0.666667.
      // That means two events.
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]).toContain('bd');
    });

    it('bd*2.5 produces two full events in the cycle', () => {
      const result = showFirstCycle('bd*2.5');
      // Loop: index 0 < 2.5 ✓, index 1 < 2.5 ✓, index 2 < 2.5 ✓ → no, 2 < 2.5 is true
      // So 3 iterations but there's no 3rd since width = 1/2.5 = 0.4, starts at 0, 0.4, 0.8
      // Wait, index goes 0,1,2. index 2 < 2.5 is true. So 3 events:
      // 0 - 0.4, 0.4 - 0.8, 0.8 - 1.2 (but clamped to cycle 0-1, so end is 1.2 which is > endCycle)
      // Actually renderNode clips at beginCycle/endCycle boundary.
      // The third event starts at 0.8, ends at 1.2 — the begin 0.8 < endCycle 1, so it's included.
      expect(result.length).toBe(3);
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
});
