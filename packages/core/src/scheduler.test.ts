import { type ExternalDispatchEvent, Scheduler } from '@tussel/core';
import { defineScene, note, type SceneSpec, s, stack, value } from '@tussel/dsl';
import { describe, expect, it } from 'vitest';

describe('scheduler', () => {
  it('does not schedule triggers in the past for shifted events on startup', () => {
    const harness = createHarness();

    harness.scheduler.setScene(
      defineScene({
        root: stack(s('bd').early(0.25), s('hh').late(0.01)),
      }),
    );
    harness.scheduler.start();
    harness.scheduler.stop();

    const targetTimes = harness.triggers.map((trigger) => trigger.targetTime);

    expect(targetTimes.length).toBeGreaterThan(0);
    expect(targetTimes.every((targetTime) => targetTime >= 0.001)).toBe(true);
  });

  it('schedules deterministically across multiple interval ticks', () => {
    const harness = createHarness();
    harness.scheduler.setScene(createFastScene('bd'));
    harness.scheduler.start();

    harness.tickAt(0.05);
    harness.tickAt(0.1);
    harness.scheduler.stop();

    expect(harness.triggers.map((trigger) => trigger.event.payload.s)).toEqual(['bd', 'bd', 'bd', 'bd']);
    const targetTimes = harness.triggers.map((trigger) => trigger.targetTime);
    expect(targetTimes[0]).toBeCloseTo(0.01, 6);
    expect(targetTimes[1]).toBeCloseTo(0.06, 6);
    expect(targetTimes[2]).toBeCloseTo(0.11, 6);
    expect(targetTimes[3]).toBeCloseTo(0.16, 6);
  });

  it('adapts target-time density after cps changes mid-playback', () => {
    const harness = createHarness();
    harness.scheduler.setScene(createFastScene('bd', false));
    harness.scheduler.setCps(1);
    harness.scheduler.start();

    const beforeChangeCount = harness.triggers.length;
    harness.scheduler.setCps(2);
    harness.tickAt(0.05);
    harness.scheduler.stop();

    const changedBatch = harness.triggers.slice(beforeChangeCount).map((trigger) => trigger.targetTime);

    expect(changedBatch).toHaveLength(3);
    expect(changedBatch[0]).toBeCloseTo(0.06, 6);
    expect(changedBatch[1]).toBeCloseTo(0.085, 6);
    expect(changedBatch[2]).toBeCloseTo(0.11, 6);
  });

  it('uses the latest scene after a hot swap while running', () => {
    const harness = createHarness();
    harness.scheduler.setScene(createFastScene('bd'));
    harness.scheduler.start();

    harness.scheduler.setScene(createFastScene('hh'));
    harness.tickAt(0.05);
    harness.scheduler.stop();

    expect(harness.triggers[0]?.event.payload.s).toBe('bd');
    expect(harness.triggers.slice(1).map((trigger) => trigger.event.payload.s)).toEqual(['hh']);
  });

  it('rejects invalid cps values and does not schedule after stop', () => {
    const harness = createHarness();
    harness.scheduler.setScene(createFastScene('bd'));
    harness.scheduler.start();

    expect(harness.scheduler.cps).toBe(1);
    expect(() => harness.scheduler.setCps(Number.NaN)).toThrow(
      'Scheduler.setCps() requires a positive finite number',
    );
    expect(() => harness.scheduler.setCps(0)).toThrow('Scheduler.setCps() requires a positive finite number');
    expect(() => harness.scheduler.setCps(-1)).toThrow(
      'Scheduler.setCps() requires a positive finite number',
    );
    expect(harness.scheduler.cps).toBe(1);

    const scheduledBeforeStop = harness.triggers.length;
    harness.scheduler.stop();
    harness.tickAt(0.1);

    expect(harness.triggers).toHaveLength(scheduledBeforeStop);
    expect(harness.clearedHandles).toEqual([1]);
  });

  it('handles empty and muted scenes without failing', () => {
    const emptyHarness = createHarness();
    const emptyScene = { channels: {}, samples: [], transport: {} } satisfies SceneSpec;
    emptyHarness.scheduler.setScene(emptyScene);
    emptyHarness.scheduler.start();
    emptyHarness.tickAt(0.05);
    emptyHarness.scheduler.stop();

    expect(emptyHarness.triggers).toEqual([]);

    const mutedHarness = createHarness();
    mutedHarness.scheduler.setScene(
      defineScene({
        channels: {
          drums: {
            mute: true,
            node: s('bd').fast(20),
          },
        },
        samples: [],
        transport: { cps: 1 },
      }),
    );
    mutedHarness.scheduler.start();
    mutedHarness.tickAt(0.05);
    mutedHarness.scheduler.stop();

    expect(mutedHarness.triggers.length).toBeGreaterThan(0);
    expect(mutedHarness.triggers.every((trigger) => trigger.event.payload.mute === true)).toBe(true);
  });

  it('emits scheduled external MIDI and OSC dispatches alongside audio triggers', () => {
    const harness = createHarness();
    harness.scheduler.setScene(
      defineScene({
        channels: {
          midi: {
            node: note('c4').midiport('loopmidi').midichan(3).velocity(0.5).fast(20),
          },
          osc: {
            node: value(0.25).midicc(74).midivalue(64).midiport('loopmidi').osc('/lead/value').oscport(57120),
          },
        },
        samples: [],
        transport: { cps: 1 },
      }),
    );

    harness.scheduler.start();
    harness.tickAt(0.05);
    harness.scheduler.stop();

    expect(harness.dispatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelNumber: 3,
          kind: 'midi-note',
          note: 60,
          port: 'loopmidi',
          velocity: 64,
        }),
        expect.objectContaining({
          channelNumber: 1,
          control: 74,
          kind: 'midi-cc',
          port: 'loopmidi',
          value: 64,
        }),
        expect.objectContaining({
          host: '127.0.0.1',
          kind: 'osc',
          path: '/lead/value',
          port: 57120,
        }),
      ]),
    );
  });
});

function createFastScene(sound: string, withTransport = true) {
  return defineScene({
    channels: {
      lead: {
        node: s(sound).fast(20),
      },
    },
    samples: [],
    transport: withTransport ? { cps: 1 } : {},
  });
}

function createHarness() {
  let currentTime = 0;
  let intervalCallback: (() => void) | undefined;
  const clearedHandles: number[] = [];
  const dispatches: ExternalDispatchEvent[] = [];
  const triggers: Array<{
    event: Parameters<ConstructorParameters<typeof Scheduler>[0]['onTrigger']>[0];
    targetTime: number;
  }> = [];

  const scheduler = new Scheduler({
    clearIntervalFn: ((handle: ReturnType<typeof setInterval>) => {
      clearedHandles.push(Number(handle));
    }) as unknown as typeof clearInterval,
    getTime: () => currentTime,
    interval: 0.05,
    latency: 0,
    onExternalDispatch: (dispatch) => {
      dispatches.push(dispatch);
    },
    onTrigger: (event, targetTime) => {
      triggers.push({ event, targetTime });
    },
    overlap: 0,
    setIntervalFn: ((callback: Parameters<typeof setInterval>[0]) => {
      if (typeof callback !== 'function') {
        throw new TypeError('expected scheduler interval callback');
      }
      intervalCallback = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval,
    windowDuration: 0.05,
  });

  return {
    clearedHandles,
    dispatches,
    scheduler,
    tickAt(time: number) {
      currentTime = time;
      intervalCallback?.();
    },
    triggers,
  };
}
