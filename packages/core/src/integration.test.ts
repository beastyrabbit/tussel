import { type PlaybackEvent, queryScene } from '@tussel/core';
import { defineScene, note, s } from '@tussel/dsl';
import type { SceneSpec } from '@tussel/ir';
import { queryMini } from '@tussel/mini';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScene(node: unknown, channel = 'main'): SceneSpec {
  return defineScene({
    channels: { [channel]: { node: node as import('@tussel/ir').ExpressionValue } },
  });
}

function query(scene: SceneSpec, begin = 0, end = 1, cps = 1): PlaybackEvent[] {
  return queryScene(scene, begin, end, { cps });
}

function roundTo(value: number, digits = 9): number {
  return Number(value.toFixed(digits));
}

// ---------------------------------------------------------------------------
// I.01: Full pipeline test — mini notation through to event output
// ---------------------------------------------------------------------------
describe('I.01: full pipeline from mini notation to events', () => {
  it('parses "bd sd hh cp" and produces 4 events per cycle with equal spacing', () => {
    // Step 1: Parse with queryMini to verify the mini notation layer
    const miniEvents = queryMini('bd sd hh cp', 0, 1);
    expect(miniEvents).toHaveLength(4);

    // Verify mini events are equally spaced across [0, 1)
    for (let i = 0; i < 4; i++) {
      expect(miniEvents[i]?.begin).toBeCloseTo(i * 0.25, 9);
      expect(miniEvents[i]?.end).toBeCloseTo((i + 1) * 0.25, 9);
    }
    expect(miniEvents.map((e) => e.value)).toEqual(['bd', 'sd', 'hh', 'cp']);

    // Step 2: Create a scene using the DSL with the same mini pattern
    const scene = defineScene({
      channels: {
        drums: { node: s('bd sd hh cp') as unknown as import('@tussel/ir').ExpressionValue },
      },
    });

    // Step 3: Query events with queryScene
    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events).toHaveLength(4);

    // Step 4: Verify events have correct timing (4 events, equally spaced)
    const sorted = [...events].sort((a, b) => a.begin - b.begin);
    for (let i = 0; i < 4; i++) {
      expect(sorted[i]?.begin).toBeCloseTo(i * 0.25, 6);
      expect(sorted[i]?.end).toBeCloseTo((i + 1) * 0.25, 6);
      expect(sorted[i]?.duration).toBeCloseTo(0.25, 6);
      expect(sorted[i]?.channel).toBe('drums');
    }

    // Verify the sound names are present in payloads
    const sounds = sorted.map((e) => e.payload.s);
    expect(sounds).toEqual(expect.arrayContaining(['bd', 'sd', 'hh', 'cp']));
  });

  it('produces consistent events across multiple cycles', () => {
    const scene = defineScene({
      channels: {
        drums: { node: s('bd sd hh cp') as unknown as import('@tussel/ir').ExpressionValue },
      },
    });

    const cycle0 = queryScene(scene, 0, 1, { cps: 1 });
    const cycle1 = queryScene(scene, 1, 2, { cps: 1 });

    expect(cycle0).toHaveLength(4);
    expect(cycle1).toHaveLength(4);

    // Events in cycle 1 should be offset by exactly 1 from cycle 0
    for (let i = 0; i < 4; i++) {
      expect(roundTo((cycle1[i]?.begin ?? 0) - (cycle0[i]?.begin ?? 0))).toBe(1);
      expect(roundTo((cycle1[i]?.end ?? 0) - (cycle0[i]?.end ?? 0))).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// I.03: Format conversion roundtrip — DSL to JSON to events
// ---------------------------------------------------------------------------
describe('I.03: format conversion roundtrip', () => {
  it('serializes a DSL scene to JSON and deserializes back with identical events', () => {
    // Step 1: Create a scene using DSL
    const original = defineScene({
      channels: {
        lead: { node: note('c e g').fast(2).gain(0.5) as unknown as import('@tussel/ir').ExpressionValue },
      },
    });

    // Step 2: Serialize to JSON (scene spec is a plain object)
    const json = JSON.stringify(original);

    // Step 3: Deserialize back
    const deserialized = JSON.parse(json) as SceneSpec;

    // Step 4: Query both and verify identical events
    const originalEvents = queryScene(original, 0, 1, { cps: 1 });
    const deserializedEvents = queryScene(deserialized, 0, 1, { cps: 1 });

    expect(originalEvents.length).toBeGreaterThan(0);
    expect(deserializedEvents).toEqual(originalEvents);
  });

  it('preserves complex DSL structures through serialization', () => {
    const original = defineScene({
      channels: {
        bass: { node: note('c3 e3').slow(2) as unknown as import('@tussel/ir').ExpressionValue },
        lead: { node: note('c5 e5 g5').fast(2) as unknown as import('@tussel/ir').ExpressionValue },
      },
      transport: { cps: 0.5 },
    });

    const roundtripped = JSON.parse(JSON.stringify(original)) as SceneSpec;

    // Query over 2 cycles to exercise slow(2)
    const originalEvents = queryScene(original, 0, 2, { cps: 0.5 });
    const roundtrippedEvents = queryScene(roundtripped, 0, 2, { cps: 0.5 });

    expect(originalEvents.length).toBeGreaterThan(0);
    expect(roundtrippedEvents).toEqual(originalEvents);
  });
});

// ---------------------------------------------------------------------------
// I.04: Multi-channel mixing — independent channels with correct sorting
// ---------------------------------------------------------------------------
describe('I.04: multi-channel mixing', () => {
  it('produces independent events for 4 channels', () => {
    const scene = defineScene({
      channels: {
        bass: { node: note('c2 e2') as unknown as import('@tussel/ir').ExpressionValue },
        drums: { node: s('bd sd hh cp') as unknown as import('@tussel/ir').ExpressionValue },
        lead: { node: note('c5 e5 g5') as unknown as import('@tussel/ir').ExpressionValue },
        pad: { node: note('c4').slow(2) as unknown as import('@tussel/ir').ExpressionValue },
      },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });

    // Verify each channel produces the expected number of events
    const byChannel = new Map<string, PlaybackEvent[]>();
    for (const event of events) {
      const list = byChannel.get(event.channel) ?? [];
      list.push(event);
      byChannel.set(event.channel, list);
    }

    expect(byChannel.get('bass')).toHaveLength(2);
    expect(byChannel.get('drums')).toHaveLength(4);
    expect(byChannel.get('lead')).toHaveLength(3);
    expect(byChannel.get('pad')).toHaveLength(1);

    // Total events = 2 + 4 + 3 + 1 = 10
    expect(events).toHaveLength(10);
  });

  it('events are sorted by begin time across channels', () => {
    const scene = defineScene({
      channels: {
        a: { node: note('c e g b') as unknown as import('@tussel/ir').ExpressionValue },
        b: { node: s('bd sd hh') as unknown as import('@tussel/ir').ExpressionValue },
        c: { node: note('d f') as unknown as import('@tussel/ir').ExpressionValue },
      },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });

    // Verify sorted by begin time (queryScene contract)
    for (let i = 1; i < events.length; i++) {
      expect(events[i]?.begin).toBeGreaterThanOrEqual(events[i - 1]?.begin ?? 0);
    }
  });

  it('channels with different subdivisions do not interfere', () => {
    const scene = defineScene({
      channels: {
        fast: { node: note('c').fast(8) as unknown as import('@tussel/ir').ExpressionValue },
        slow: { node: note('d').slow(4) as unknown as import('@tussel/ir').ExpressionValue },
      },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    const fastEvents = events.filter((e) => e.channel === 'fast');
    const slowEvents = events.filter((e) => e.channel === 'slow');

    expect(fastEvents).toHaveLength(8);
    expect(slowEvents).toHaveLength(1);

    // Fast channel events should each be 1/8 of a cycle
    for (const e of fastEvents) {
      expect(e.duration).toBeCloseTo(0.125, 6);
    }

    // Slow channel event spans 4 cycles (slow(4) stretches to 4x duration)
    expect(slowEvents[0]?.begin).toBe(0);
    expect(slowEvents[0]?.duration).toBeCloseTo(4, 6);
  });
});

// ---------------------------------------------------------------------------
// I.05: Long-running stability — no drift over 100 cycles
// ---------------------------------------------------------------------------
describe('I.05: long-running stability', () => {
  it('maintains consistent timing over 100 cycles with no drift', () => {
    const scene = makeScene(note('c e g'));
    const events = query(scene, 0, 100);

    // 3 events per cycle * 100 cycles = 300 events
    expect(events).toHaveLength(300);

    // Check that every event boundary aligns to the expected grid
    const step = 1 / 3;
    for (const event of events) {
      const cycle = Math.floor(event.begin);
      const offset = event.begin - cycle;

      // offset should be 0, 1/3, or 2/3
      const closestSlot = Math.round(offset / step) * step;
      expect(offset).toBeCloseTo(closestSlot, 9);

      // Duration should consistently be 1/3
      expect(event.duration).toBeCloseTo(step, 9);
    }
  });

  it('cycle boundaries are exact integers', () => {
    const scene = makeScene(note('c e'));
    const events = query(scene, 0, 100);

    // 2 events per cycle * 100 = 200
    expect(events).toHaveLength(200);

    // Events at the start of each cycle should have integer begin times
    const cycleStarts = events.filter((e) => {
      const offset = e.begin - Math.floor(e.begin);
      return offset < 1e-12;
    });

    // Should have exactly 100 events at cycle boundaries (one per cycle)
    expect(cycleStarts).toHaveLength(100);

    // Verify each cycle start is an exact integer
    for (const e of cycleStarts) {
      expect(e.begin).toBe(Math.round(e.begin));
    }
  });

  it('event count scales linearly with query window', () => {
    const scene = makeScene(s('bd sd hh cp'));

    const events10 = query(scene, 0, 10);
    const events50 = query(scene, 0, 50);
    const events100 = query(scene, 0, 100);

    expect(events10).toHaveLength(40);
    expect(events50).toHaveLength(200);
    expect(events100).toHaveLength(400);
  });

  it('events at far-future cycles have no accumulated drift', () => {
    const scene = makeScene(note('c e g b'));
    const step = 0.25;

    // Query a window deep into the future
    const events = query(scene, 999, 1000);
    expect(events).toHaveLength(4);

    for (let i = 0; i < events.length; i++) {
      expect(events[i]?.begin).toBeCloseTo(999 + i * step, 9);
      expect(events[i]?.end).toBeCloseTo(999 + (i + 1) * step, 9);
    }
  });
});
