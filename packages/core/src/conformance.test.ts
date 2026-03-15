import { queryScene } from '@tussel/core';
import { cosine, defineScene, rand, saw, seq, sine, square, triangle } from '@tussel/dsl';
import { describe, expect, it } from 'vitest';
import { evaluateNumericValue } from './index.js';

describe('reference conformance', () => {
  it('matches the Tidal saw baseline at common cycle positions', () => {
    expect(evaluateNumericValue(saw.expr, 0)).toBe(0);
    expect(evaluateNumericValue(saw.expr, 0.25)).toBeCloseTo(0.25, 6);
    expect(evaluateNumericValue(saw.expr, 0.5)).toBeCloseTo(0.5, 6);
    expect(evaluateNumericValue(saw.expr, 0.75)).toBeCloseTo(0.75, 6);
  });

  it('evaluates cosine signals instead of silently returning zero', () => {
    expect(evaluateNumericValue(cosine.expr, 0)).toBeCloseTo(1, 6);
    expect(evaluateNumericValue(cosine.expr, 0.25)).toBeCloseTo(0.5, 6);
    expect(evaluateNumericValue(cosine.expr, 0.5)).toBeCloseTo(0, 6);
  });

  it('matches selected Tidal range cases', () => {
    expect(evaluateNumericValue(saw.range(3, 4).expr, 0)).toBe(3);
    expect(evaluateNumericValue(saw.range(3, 4).expr, 0.25)).toBeCloseTo(3.25, 6);
    expect(evaluateNumericValue(saw.range(3, 4).expr, 0.75)).toBeCloseTo(3.75, 6);
    expect(evaluateNumericValue(saw.range(-1, 1).expr, 0.5)).toBeCloseTo(0, 6);
    expect(evaluateNumericValue(saw.range(4, 2).expr, 0)).toBe(4);
    expect(evaluateNumericValue(saw.range(4, 2).expr, 0.25)).toBeCloseTo(3.5, 6);
    expect(evaluateNumericValue(saw.range(4, 2).expr, 0.75)).toBeCloseTo(2.5, 6);
    expect(evaluateNumericValue(saw.range(10, 10).expr, 0.5)).toBe(10);
  });

  it('treats cat entries as cycle-wise concatenation like Strudel', () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: {
            args: [{ note: 'c' }, { note: 'e' }, { note: 'g' }],
            exprType: 'pattern',
            kind: 'call',
            name: 'cat',
          },
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(scene, 0, 2, { cps: 1 })).toEqual([
      {
        begin: 0,
        channel: 'lead',
        duration: 1,
        end: 1,
        payload: { note: 'c' },
      },
      {
        begin: 1,
        channel: 'lead',
        duration: 1,
        end: 2,
        payload: { note: 'e' },
      },
    ]);
  });

  it('evaluates sine signal at common positions', () => {
    expect(evaluateNumericValue(sine.expr, 0)).toBeCloseTo(0.5, 6);
    expect(evaluateNumericValue(sine.expr, 0.25)).toBeCloseTo(1, 6);
    expect(evaluateNumericValue(sine.expr, 0.5)).toBeCloseTo(0.5, 6);
    expect(evaluateNumericValue(sine.expr, 0.75)).toBeCloseTo(0, 6);
  });

  it('evaluates square signal at common positions', () => {
    // Square wave: 0 for first half (phase < 0.5), 1 for second half (phase >= 0.5)
    expect(evaluateNumericValue(square.expr, 0.1)).toBe(0);
    expect(evaluateNumericValue(square.expr, 0.4)).toBe(0);
    expect(evaluateNumericValue(square.expr, 0.6)).toBe(1);
    expect(evaluateNumericValue(square.expr, 0.9)).toBe(1);
  });

  it('evaluates triangle signal at common positions', () => {
    // Triangle: 0 at 0, rises to 1 at 0.5, back to 0 at 1
    expect(evaluateNumericValue(triangle.expr, 0)).toBeCloseTo(0, 6);
    expect(evaluateNumericValue(triangle.expr, 0.25)).toBeCloseTo(0.5, 6);
    expect(evaluateNumericValue(triangle.expr, 0.5)).toBeCloseTo(1, 6);
    expect(evaluateNumericValue(triangle.expr, 0.75)).toBeCloseTo(0.5, 6);
  });

  it('evaluates rand signal to values in [0, 1)', () => {
    for (let i = 0; i < 20; i++) {
      const val = evaluateNumericValue(rand.expr, i * 0.37) ?? -1;
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it('evaluates saw range with inverted bounds', () => {
    // range(high, low) should still produce valid interpolated values
    const val = evaluateNumericValue(saw.range(10, 0).expr, 0.5);
    expect(val).toBeCloseTo(5, 2);
  });

  it('evaluates saw with fast modifier', () => {
    // fast(2) should double the speed, so position 0.25 at fast(2) = position 0.5 at normal
    const normal = evaluateNumericValue(saw.expr, 0.5) ?? 0;
    const fasted = evaluateNumericValue(saw.fast(2).expr, 0.25) ?? 0;
    expect(fasted).toBeCloseTo(normal, 6);
  });

  it('treats seq entries as within-cycle subdivision like Strudel', () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: {
            args: [seq('c', 'e', 'g').expr],
            exprType: 'pattern',
            kind: 'call',
            name: 'note',
          },
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const roundEvents = (events: ReturnType<typeof queryScene>) =>
      events.map((event) => ({
        ...event,
        begin: Number(event.begin.toFixed(9)),
        duration: Number(event.duration.toFixed(9)),
        end: Number(event.end.toFixed(9)),
      }));

    expect(roundEvents(queryScene(scene, 0, 1, { cps: 1 }))).toEqual([
      {
        begin: 0,
        channel: 'lead',
        duration: 0.333333333,
        end: 0.333333333,
        payload: { note: 'c' },
      },
      {
        begin: 0.333333333,
        channel: 'lead',
        duration: 0.333333333,
        end: 0.666666667,
        payload: { note: 'e' },
      },
      {
        begin: 0.666666667,
        channel: 'lead',
        duration: 0.333333333,
        end: 1,
        payload: { note: 'g' },
      },
    ]);
  });
});
