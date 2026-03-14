import { describe, expect, it } from 'vitest';
import { isMondoNotation, parseMondo, queryMondo, showMondoFirstCycle } from './mondo.js';

describe('mondo notation', () => {
  describe('parseMondo', () => {
    it('parses a basic kick pattern', () => {
      const events = parseMondo('x...x...');
      expect(events).toEqual([
        { begin: 0, end: 0.125, value: 'bd' },
        { begin: 0.5, end: 0.625, value: 'bd' },
      ]);
    });

    it('parses a multi-instrument pattern', () => {
      const events = parseMondo('x.o.x.o.');
      expect(events).toEqual([
        { begin: 0, end: 0.125, value: 'bd' },
        { begin: 0.25, end: 0.375, value: 'sd' },
        { begin: 0.5, end: 0.625, value: 'bd' },
        { begin: 0.75, end: 0.875, value: 'sd' },
      ]);
    });

    it('handles bar separators without affecting step count', () => {
      // "|x...|x.x.|" -> bars are visual only
      // After removing |: "x...x.x." = 8 steps
      const events = parseMondo('|x...|x.x.|');
      expect(events).toEqual([
        { begin: 0, end: 0.125, value: 'bd' },
        { begin: 0.5, end: 0.625, value: 'bd' },
        { begin: 0.75, end: 0.875, value: 'bd' },
      ]);
    });

    it('handles rests with dots', () => {
      const events = parseMondo('....');
      expect(events).toEqual([]);
    });

    it('handles rests with underscores', () => {
      const events = parseMondo('x__x');
      expect(events).toEqual([
        { begin: 0, end: 0.25, value: 'bd' },
        { begin: 0.75, end: 1, value: 'bd' },
      ]);
    });

    it('parses hihat pattern', () => {
      const events = parseMondo('--------');
      expect(events).toHaveLength(8);
      expect(events[0]).toEqual({ begin: 0, end: 0.125, value: 'hh' });
      for (const event of events) {
        expect(event.value).toBe('hh');
      }
    });

    it('parses open hihat', () => {
      const events = parseMondo('=...');
      expect(events).toEqual([{ begin: 0, end: 0.25, value: 'oh' }]);
    });

    it('parses clap pattern', () => {
      const events = parseMondo('*...*...');
      expect(events).toEqual([
        { begin: 0, end: 0.125, value: 'cp' },
        { begin: 0.5, end: 0.625, value: 'cp' },
      ]);
    });

    it('returns empty for empty source', () => {
      expect(parseMondo('')).toEqual([]);
    });

    it('returns empty for whitespace-only source', () => {
      expect(parseMondo('   ')).toEqual([]);
    });

    it('returns empty for all-rest patterns', () => {
      expect(parseMondo('....')).toEqual([]);
      expect(parseMondo('____')).toEqual([]);
    });

    it('handles a single character', () => {
      const events = parseMondo('x');
      expect(events).toEqual([{ begin: 0, end: 1, value: 'bd' }]);
    });

    it('stacks multiple lines (polyphonic)', () => {
      const events = parseMondo('x...x...\n....o...');
      // Line 1: kick at 0 and 4 of 8
      // Line 2: snare at 4 of 8
      expect(events).toEqual([
        { begin: 0, end: 0.125, value: 'bd' },
        { begin: 0.5, end: 0.625, value: 'bd' },
        { begin: 0.5, end: 0.625, value: 'sd' },
      ]);
    });

    it('handles mixed instruments in one line', () => {
      const events = parseMondo('xo-=');
      expect(events).toEqual([
        { begin: 0, end: 0.25, value: 'bd' },
        { begin: 0.25, end: 0.5, value: 'sd' },
        { begin: 0.5, end: 0.75, value: 'hh' },
        { begin: 0.75, end: 1, value: 'oh' },
      ]);
    });

    it('uses alternative character aliases', () => {
      // k=kick, s=snare, h=hihat, H=open hihat, c=clap, r=rim
      const events = parseMondo('kshH');
      expect(events).toEqual([
        { begin: 0, end: 0.25, value: 'bd' },
        { begin: 0.25, end: 0.5, value: 'sd' },
        { begin: 0.5, end: 0.75, value: 'hh' },
        { begin: 0.75, end: 1, value: 'oh' },
      ]);
    });

    it('ignores whitespace within lines', () => {
      const events = parseMondo('x . . . x . . .');
      expect(events).toEqual([
        { begin: 0, end: 0.125, value: 'bd' },
        { begin: 0.5, end: 0.625, value: 'bd' },
      ]);
    });
  });

  describe('step timing accuracy', () => {
    it('distributes 4 steps evenly across one cycle', () => {
      const events = parseMondo('xoxo');
      expect(events).toHaveLength(4);
      expect(events[0]?.begin).toBeCloseTo(0, 10);
      expect(events[0]?.end).toBeCloseTo(0.25, 10);
      expect(events[1]?.begin).toBeCloseTo(0.25, 10);
      expect(events[1]?.end).toBeCloseTo(0.5, 10);
      expect(events[2]?.begin).toBeCloseTo(0.5, 10);
      expect(events[2]?.end).toBeCloseTo(0.75, 10);
      expect(events[3]?.begin).toBeCloseTo(0.75, 10);
      expect(events[3]?.end).toBeCloseTo(1, 10);
    });

    it('distributes 16 steps evenly (standard drum machine grid)', () => {
      const events = parseMondo('x...o...x...o...');
      expect(events).toHaveLength(4);
      expect(events[0]?.begin).toBeCloseTo(0, 10);
      expect(events[0]?.end).toBeCloseTo(0.0625, 10);
      expect(events[1]?.begin).toBeCloseTo(0.25, 10);
      expect(events[1]?.end).toBeCloseTo(0.3125, 10);
      expect(events[2]?.begin).toBeCloseTo(0.5, 10);
      expect(events[2]?.end).toBeCloseTo(0.5625, 10);
      expect(events[3]?.begin).toBeCloseTo(0.75, 10);
      expect(events[3]?.end).toBeCloseTo(0.8125, 10);
    });

    it('handles odd step counts correctly', () => {
      const events = parseMondo('x.x');
      expect(events).toHaveLength(2);
      expect(events[0]?.begin).toBeCloseTo(0, 10);
      expect(events[0]?.end).toBeCloseTo(1 / 3, 10);
      expect(events[1]?.begin).toBeCloseTo(2 / 3, 10);
      expect(events[1]?.end).toBeCloseTo(1, 10);
    });
  });

  describe('queryMondo', () => {
    it('queries one cycle', () => {
      const events = queryMondo('x.o.', 0, 1);
      expect(events).toEqual([
        { begin: 0, end: 0.25, value: 'bd' },
        { begin: 0.5, end: 0.75, value: 'sd' },
      ]);
    });

    it('tiles across multiple cycles', () => {
      const events = queryMondo('x...', 0, 3);
      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ begin: 0, end: 0.25, value: 'bd' });
      expect(events[1]).toEqual({ begin: 1, end: 1.25, value: 'bd' });
      expect(events[2]).toEqual({ begin: 2, end: 2.25, value: 'bd' });
    });

    it('filters by query range', () => {
      const events = queryMondo('x.x.', 0.5, 1.5);
      // Cycle 0: x at 0, x at 0.5 -- only second is in range
      // Cycle 1: x at 1, x at 1.5 -- only first is in range
      expect(events).toEqual([
        { begin: 0.5, end: 0.75, value: 'bd' },
        { begin: 1, end: 1.25, value: 'bd' },
      ]);
    });

    it('returns empty for empty source', () => {
      expect(queryMondo('', 0, 1)).toEqual([]);
    });
  });

  describe('isMondoNotation', () => {
    it('detects basic mondo patterns', () => {
      expect(isMondoNotation('x...x...')).toBe(true);
      expect(isMondoNotation('x.o.x.o.')).toBe(true);
      expect(isMondoNotation('--------')).toBe(true);
    });

    it('detects patterns with bar separators', () => {
      expect(isMondoNotation('|x...|x.x.|')).toBe(true);
    });

    it('rejects mini notation patterns', () => {
      expect(isMondoNotation('bd hh sd')).toBe(false);
      expect(isMondoNotation('[bd hh] sd')).toBe(false);
      expect(isMondoNotation('<a b>')).toBe(false);
      expect(isMondoNotation('bd*2')).toBe(false);
      expect(isMondoNotation('a,b')).toBe(false);
    });

    it('rejects empty strings', () => {
      expect(isMondoNotation('')).toBe(false);
      expect(isMondoNotation('   ')).toBe(false);
    });

    it('detects single trigger characters', () => {
      expect(isMondoNotation('x')).toBe(true);
      expect(isMondoNotation('o')).toBe(true);
    });

    it('rejects all-rest patterns (no triggers)', () => {
      expect(isMondoNotation('....')).toBe(false);
      expect(isMondoNotation('____')).toBe(false);
    });

    it('rejects strings with unrecognized characters', () => {
      expect(isMondoNotation('hello world')).toBe(false);
      expect(isMondoNotation('bd:2')).toBe(false);
    });

    it('detects multi-line mondo patterns', () => {
      expect(isMondoNotation('x...x...\n....o...')).toBe(true);
    });
  });

  describe('showMondoFirstCycle', () => {
    it('formats events for debugging', () => {
      const output = showMondoFirstCycle('x.o.');
      expect(output).toEqual(['bd: 0 - 0.25', 'sd: 0.5 - 0.75']);
    });
  });
});
