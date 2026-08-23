import { queryScene } from '@tussel/core';
import { defineScene, note, s } from '@tussel/dsl';
import { describe, expect, it } from 'vitest';

function queryChannel(node: unknown, begin = 0, end = 4) {
  const scene = defineScene({
    channels: { lead: { node: node as never } },
    samples: [],
    transport: { cps: 1 },
  });
  return queryScene(scene, begin, end, { cps: 1 });
}

describe('tidal expansion transforms', () => {
  it('legato scales event durations', () => {
    const plain = queryChannel(s('bd sd hh cp'));
    const stretched = queryChannel(s('bd sd hh cp').legato(2));
    expect(plain.length).toBe(16);
    expect(stretched.length).toBe(16);
    expect(stretched[0]?.duration).toBeCloseTo((plain[0]?.duration ?? 0) * 2, 6);
  });

  it('whenmod applies the transform during the last t cycles of n', () => {
    // fast(3) applied on odd cycles (last cycle of every 2)
    const events = queryChannel(s('bd').whenmod(2, 1, s('bd').fast(3)), 0, 4);
    const countsByCycle = [0, 1, 2, 3].map(
      (cycle) => events.filter((event) => event.begin >= cycle && event.begin < cycle + 1).length,
    );
    expect(countsByCycle).toEqual([1, 3, 1, 3]);
  });

  it('stut echoes events with decaying gain', () => {
    const events = queryChannel(note('0').stut(2, 0.25, 0.5), 0, 1);
    // Original (no gain annotation) plus two annotated echoes
    const echoes = events
      .filter((event) => typeof event.payload.gain === 'number')
      .map((event) => ({ begin: event.begin as number, gain: event.payload.gain as number }))
      .sort((a, b) => a.begin - b.begin);
    expect(events.length).toBe(3);
    expect(echoes.length).toBe(2);
    expect(echoes[0]).toEqual({ begin: 0.25, gain: 0.5 });
    expect(echoes[1]).toEqual({ begin: 0.5, gain: 0.25 });
  });

  it('spin layers copies panned across the stereo field', () => {
    const events = queryChannel(s('bd*2').spin(3), 0, 1);
    const pans = [...new Set(events.map((event) => event.payload.pan))].sort();
    expect(pans).toEqual([-1, 0, 1]);
    // Every layer contributes its two bd*2 hits (window edges may add overlap copies).
    const counts = [0, -1, 1].map((pan) => events.filter((event) => event.payload.pan === pan).length);
    expect(counts.every((count) => count >= 2)).toBe(true);
  });

  it('striate splits each event into sample-window slices', () => {
    const events = queryChannel(s('bd').striate(4), 0, 1);
    expect(events.length).toBe(4);
    expect(events[0]?.payload.begin).toBeCloseTo(0, 6);
    expect(events[0]?.payload.end).toBeCloseTo(0.25, 6);
    expect(events[3]?.payload.begin).toBeCloseTo(0.75, 6);
    expect(events[3]?.payload.end).toBeCloseTo(1, 6);
    // Slices tile the original event window sequentially.
    expect(events[1]?.begin).toBeCloseTo(0.25, 6);
    expect(events[2]?.begin).toBeCloseTo(0.5, 6);
  });

  it('chop slices like striate with sequential windows', () => {
    const events = queryChannel(s('bd').chop(2), 0, 1);
    expect(events.length).toBe(2);
    expect(events[0]?.payload.begin).toBeCloseTo(0, 6);
    expect(events[1]?.payload.end).toBeCloseTo(1, 6);
  });

  it('up annotates semitone offset payloads', () => {
    const events = queryChannel(note('0 4').up(12), 0, 1);
    expect(events.map((event) => event.payload.up)).toEqual([12, 12]);
  });

  it('fastspread stacks time-scaled copies', () => {
    const events = queryChannel(s('bd sd').fastspread(1, 2), 0, 1);
    // Factor 1 contributes 2 hits; factor 2 compresses two cycles into the
    // window and contributes 4.
    expect(events.length).toBe(6);
    const sorted = [...events].sort((a, b) => a.begin - b.begin);
    expect(sorted.map((event) => Number(event.begin.toFixed(3)))).toEqual([0, 0, 0.25, 0.5, 0.5, 0.75]);
  });

  it('slowspread stretches copies', () => {
    const events = queryChannel(s('bd sd').slowspread([1]), 0, 2);
    // slow(1) is identity: both hits land within the first cycle
    expect(events.filter((event) => event.begin < 1).length).toBe(2);
  });

  it('fit maps integer steps through a lookup table', () => {
    const events = queryChannel(note('0 1 2 3').fit(3, [60, 62, 64, 999]), 0, 1);
    // Only the first 3 table entries are addressable; indices wrap mod 3
    expect(events.map((event) => event.payload.note)).toEqual([60, 62, 64, 60]);
  });

  it('bite selects target slices via the generator', () => {
    // Slice 0 holds notes 0 and 1; the slice is stretched across the cycle.
    const firstHalf = queryChannel(note('0 1 2 3').bite(2, note('0')), 0, 1);
    expect(firstHalf.map((event) => event.payload.note)).toEqual([0, 1]);
    expect(firstHalf.map((event) => Number(event.begin.toFixed(3)))).toEqual([0, 0.5]);

    // Slice 1 holds notes 2 and 3.
    const secondHalf = queryChannel(note('0 1 2 3').bite(2, note('1')), 0, 1);
    expect(secondHalf.map((event) => event.payload.note)).toEqual([2, 3]);
  });

  it('unit annotates playback-unit payloads', () => {
    const events = queryChannel(s('bd').unit('r'), 0, 1);
    expect(events.map((event) => event.payload.unit)).toEqual(['r']);
  });
});

describe('spread combinators', () => {
  it('spread stacks fn(arg) applied to the target for each arg', async () => {
    const { spread, slow } = await import('@tussel/dsl');
    const events = queryChannel(spread(slow, [1, 2], s('bd sd')), 0, 1);
    // slow(1) layer: 2 hits; slow(2) layer: 1 hit stretched across the cycle
    expect(events.length).toBe(3);
  });

  it('slowspread and fastspread compose through slow/fast', async () => {
    const { fastspread, slowspread } = await import('@tussel/dsl');
    const spreadSlow = queryChannel(slowspread([1], s('bd sd')), 0, 1);
    expect(spreadSlow.length).toBe(2);
    const spreadFast = queryChannel(fastspread([2], s('bd sd')), 0, 1);
    // fast(2) compresses two cycles into the window
    expect(spreadFast.length).toBe(4);
  });
});
