import { queryScene } from '@tussel/core';
import {
  add,
  areStringPrototypeExtensionsInstalled,
  defineScene,
  installStringPrototypeExtensions,
  note,
  s,
  sine,
  uninstallStringPrototypeExtensions,
} from '@tussel/dsl';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  while (areStringPrototypeExtensionsInstalled()) {
    uninstallStringPrototypeExtensions();
  }
});

describe('value-pattern runtime support', () => {
  it('resolves transformed string patterns as property values', () => {
    installStringPrototypeExtensions();
    const scene = defineScene({
      channels: {
        lead: {
          node: s('bd bd bd bd').room('0 1'.fast(2)),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.map((event) => event.payload.room)).toEqual([0, 1, 0, 1]);
  });

  it('uses transformed string patterns as masks', () => {
    installStringPrototypeExtensions();
    const scene = defineScene({
      channels: {
        lead: {
          node: s('bd bd bd bd').mask('1 0'.fast(2)),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.map((event) => event.begin)).toEqual([0, 0.5]);
  });

  it('carries begin and end controls through to playback events', () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: s('bd').begin(0.25).end(0.75),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.begin).toBe(0.25);
    expect(events[0]?.payload.end).toBe(0.75);
  });

  it('treats clip as playable duration without shortening the event span', () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: s('bd').begin(0.25).end(0.75).clip(0.5).speed(2),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events).toHaveLength(1);
    expect(events[0]?.begin).toBe(0);
    expect(events[0]?.end).toBe(1);
    expect(events[0]?.duration).toBe(0.5);
    expect(events[0]?.payload.begin).toBe(0.25);
    expect(events[0]?.payload.end).toBe(0.75);
    expect(events[0]?.payload.clip).toBe(0.5);
    expect(events[0]?.payload.speed).toBe(2);
  });

  it('applies chunk transforms one slice at a time across repeated cycles', () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: note('0 1 2 3').chunk(4, add(7)),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const firstFourCycles = queryScene(scene, 0, 4, { cps: 1 })
      .map((event) => event.payload.note)
      .filter((value): value is number => typeof value === 'number');

    expect(firstFourCycles).toEqual([7, 1, 2, 3, 0, 8, 2, 3, 0, 1, 9, 3, 0, 1, 2, 10]);
  });

  it('segments signal expressions into discrete values', () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: note(sine.range(0, 4)).segment(4),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.map((event) => Number((event.payload.note as number).toFixed(6)))).toEqual([2, 4, 2, 0]);
  });

  it('warns when unsupported pattern calls would otherwise fail silently', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scene = defineScene({
      channels: {
        lead: {
          node: {
            args: ['bd hh'],
            exprType: 'pattern',
            kind: 'call',
            name: 'definitelyUnsupported',
          },
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    expect(queryScene(scene, 0, 1, { cps: 1 })).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      '[tussel/core] unsupported pattern call "definitelyUnsupported" currently returns silence.',
    );
    warnSpy.mockRestore();
  });
});
