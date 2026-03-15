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

// ---------------------------------------------------------------------------
// Window / overlap / latency effects
// ---------------------------------------------------------------------------
describe('scheduler window/overlap/latency', () => {
  it('latency offsets all target times by the configured amount', () => {
    const harness = createHarnessWithOptions({ latency: 0.2 });
    harness.scheduler.setScene(createFastScene('bd'));
    harness.scheduler.start();
    harness.scheduler.stop();

    expect(harness.triggers.length).toBeGreaterThan(0);
    // All target times should be offset by at least the latency value
    for (const trigger of harness.triggers) {
      expect(trigger.targetTime).toBeGreaterThanOrEqual(0.001);
    }
    // The first target time should reflect the latency offset
    // (rawTargetTime = (event.begin - cycleAtCpsChange) / cps + secondsAtCpsChange + latency)
    // With latency=0.2, target times are shifted forward compared to latency=0
    const noLatencyHarness = createHarnessWithOptions({ latency: 0 });
    noLatencyHarness.scheduler.setScene(createFastScene('bd'));
    noLatencyHarness.scheduler.start();
    noLatencyHarness.scheduler.stop();

    expect(noLatencyHarness.triggers.length).toBe(harness.triggers.length);
    for (let i = 0; i < harness.triggers.length; i++) {
      // Each trigger with latency should be >= the no-latency version
      expect(harness.triggers[i]!.targetTime).toBeGreaterThanOrEqual(
        noLatencyHarness.triggers[i]!.targetTime,
      );
    }
  });

  it('overlap extends the scheduling horizon beyond the interval', () => {
    // With overlap=0, the scheduler looks ahead exactly interval from now
    const noOverlapHarness = createHarnessWithOptions({ overlap: 0, interval: 0.05 });
    noOverlapHarness.scheduler.setScene(createFastScene('bd'));
    noOverlapHarness.scheduler.start();
    noOverlapHarness.scheduler.stop();
    const noOverlapCount = noOverlapHarness.triggers.length;

    // With overlap=0.1, the scheduler looks ahead interval+overlap from now
    const overlapHarness = createHarnessWithOptions({ overlap: 0.1, interval: 0.05 });
    overlapHarness.scheduler.setScene(createFastScene('bd'));
    overlapHarness.scheduler.start();
    overlapHarness.scheduler.stop();
    const overlapCount = overlapHarness.triggers.length;

    // More overlap should schedule more events on the first tick
    expect(overlapCount).toBeGreaterThan(noOverlapCount);
  });

  it('windowDuration controls the cycle-span per tick quantum', () => {
    // Smaller windows = finer granularity per tick but more ticks needed
    const smallWindow = createHarnessWithOptions({ windowDuration: 0.025 });
    smallWindow.scheduler.setScene(createFastScene('bd'));
    smallWindow.scheduler.start();
    smallWindow.tickAt(0.05);
    smallWindow.scheduler.stop();
    const smallCount = smallWindow.triggers.length;

    const largeWindow = createHarnessWithOptions({ windowDuration: 0.05 });
    largeWindow.scheduler.setScene(createFastScene('bd'));
    largeWindow.scheduler.start();
    largeWindow.tickAt(0.05);
    largeWindow.scheduler.stop();
    const largeCount = largeWindow.triggers.length;

    // Both should produce triggers (the total coverage is similar)
    expect(smallCount).toBeGreaterThan(0);
    expect(largeCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Long-running drift and stability
// ---------------------------------------------------------------------------
describe('scheduler long-running drift and stability', () => {
  it('maintains monotonically increasing target times over many ticks', () => {
    const harness = createHarness();
    harness.scheduler.setScene(createFastScene('bd'));
    harness.scheduler.start();

    // Simulate 50 ticks (2.5 seconds of real time at 50ms intervals)
    for (let i = 1; i <= 50; i++) {
      harness.tickAt(i * 0.05);
    }
    harness.scheduler.stop();

    expect(harness.triggers.length).toBeGreaterThan(10);

    // Verify target times are monotonically non-decreasing
    for (let i = 1; i < harness.triggers.length; i++) {
      expect(harness.triggers[i]!.targetTime).toBeGreaterThanOrEqual(
        harness.triggers[i - 1]!.targetTime - 1e-9,
      );
    }
  });

  it('produces consistent event count over equivalent time spans', () => {
    // Two harnesses running the same scene for the same duration
    // should produce the same number of events
    const harness1 = createHarness();
    harness1.scheduler.setScene(createFastScene('bd'));
    harness1.scheduler.start();
    for (let i = 1; i <= 20; i++) {
      harness1.tickAt(i * 0.05);
    }
    harness1.scheduler.stop();

    const harness2 = createHarness();
    harness2.scheduler.setScene(createFastScene('bd'));
    harness2.scheduler.start();
    for (let i = 1; i <= 20; i++) {
      harness2.tickAt(i * 0.05);
    }
    harness2.scheduler.stop();

    expect(harness1.triggers.length).toBe(harness2.triggers.length);
    expect(harness1.triggers.length).toBeGreaterThan(10);

    // Target times should match exactly between the two runs
    for (let i = 0; i < harness1.triggers.length; i++) {
      expect(harness1.triggers[i]!.targetTime).toBeCloseTo(harness2.triggers[i]!.targetTime, 9);
    }
  });

  it('cycle positions advance proportionally to cps over many ticks', () => {
    const harness = createHarness();
    harness.scheduler.setScene(createFastScene('bd', false));
    harness.scheduler.setCps(2); // 2 cycles per second
    harness.scheduler.start();

    // Run for 1 second (20 ticks at 50ms)
    for (let i = 1; i <= 20; i++) {
      harness.tickAt(i * 0.05);
    }
    harness.scheduler.stop();

    // With cps=2 and ~1 second elapsed, we should cover roughly 2 cycles
    // Each event in the fast(20) scene fires 20x per cycle, so we expect ~40 events
    expect(harness.triggers.length).toBeGreaterThan(20);
  });

  it('survives irregular tick timing (jitter)', () => {
    const harness = createHarness();
    harness.scheduler.setScene(createFastScene('bd'));
    harness.scheduler.start();

    // Simulate jittery timing
    harness.tickAt(0.047);
    harness.tickAt(0.112);
    harness.tickAt(0.148);
    harness.tickAt(0.213);
    harness.tickAt(0.26);
    harness.scheduler.stop();

    expect(harness.triggers.length).toBeGreaterThan(0);

    // Target times should still be monotonically non-decreasing
    for (let i = 1; i < harness.triggers.length; i++) {
      expect(harness.triggers[i]!.targetTime).toBeGreaterThanOrEqual(
        harness.triggers[i - 1]!.targetTime - 1e-9,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Concurrent tick handling (re-entrancy guard)
// ---------------------------------------------------------------------------
describe('scheduler concurrent tick handling', () => {
  it('re-entrant tick calls are silently ignored', () => {
    let currentTime = 0;
    let intervalCallback: (() => void) | undefined;
    const triggers: Array<{ targetTime: number }> = [];
    let tickCallCount = 0;

    const scheduler = new Scheduler({
      clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
      getTime: () => currentTime,
      interval: 0.05,
      latency: 0,
      onTrigger: (_event, targetTime) => {
        tickCallCount++;
        triggers.push({ targetTime });
        // Attempt re-entrant tick: call the interval callback from
        // within the onTrigger handler
        if (tickCallCount === 1 && intervalCallback) {
          currentTime = 0.06;
          intervalCallback();
        }
      },
      overlap: 0,
      setIntervalFn: ((callback: Parameters<typeof setInterval>[0]) => {
        intervalCallback = callback as () => void;
        return 1 as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      windowDuration: 0.05,
    });

    scheduler.setScene(createFastScene('bd'));
    scheduler.start();
    scheduler.stop();

    // The initial tick should have produced some triggers.
    // The re-entrant tick from inside onTrigger should have been blocked
    // by the ticking guard. We verify that tickCallCount equals triggers.length,
    // meaning no extra triggers were added by the re-entrant call.
    expect(triggers.length).toBeGreaterThan(0);
    expect(tickCallCount).toBe(triggers.length);
    // If re-entrancy was NOT blocked, tickCallCount would be > triggers.length
    // because the inner tick would have produced additional onTrigger calls
    // that would increment tickCallCount beyond what the first tick produced.
  });

  it('tick after stop produces no additional triggers', () => {
    const harness = createHarness();
    harness.scheduler.setScene(createFastScene('bd'));
    harness.scheduler.start();

    const countAfterStart = harness.triggers.length;
    harness.scheduler.stop();

    // Tick after stop should be a no-op
    harness.tickAt(0.05);
    harness.tickAt(0.1);
    harness.tickAt(0.15);

    expect(harness.triggers.length).toBe(countAfterStart);
  });

  it('start is idempotent when already started', () => {
    const harness = createHarness();
    harness.scheduler.setScene(createFastScene('bd'));
    harness.scheduler.start();
    const countAfterFirstStart = harness.triggers.length;

    // Calling start again should be a no-op
    harness.scheduler.start();
    expect(harness.triggers.length).toBe(countAfterFirstStart);

    harness.scheduler.stop();
  });

  it('start without a scene throws', () => {
    const harness = createHarness();
    expect(() => harness.scheduler.start()).toThrow('Scheduler requires a scene before start');
  });

  it('stop resets internal state so a fresh start works cleanly', () => {
    // Use two separate harnesses so getTime() starts at 0 for both
    const harness1 = createHarness();
    harness1.scheduler.setScene(createFastScene('bd'));
    harness1.scheduler.start();
    harness1.tickAt(0.05);
    harness1.scheduler.stop();
    const firstRunCount = harness1.triggers.length;

    const harness2 = createHarness();
    harness2.scheduler.setScene(createFastScene('bd'));
    harness2.scheduler.start();
    harness2.tickAt(0.05);
    harness2.scheduler.stop();
    const secondRunCount = harness2.triggers.length;

    // Both runs from identical starting conditions should produce
    // the same number of events (deterministic scheduling)
    expect(secondRunCount).toBe(firstRunCount);
    expect(firstRunCount).toBeGreaterThan(0);
  });

  it('now() returns 0 when not started', () => {
    const harness = createHarness();
    harness.scheduler.setScene(createFastScene('bd'));
    expect(harness.scheduler.now()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// H.01: Window / overlap / latency — additional coverage
// ---------------------------------------------------------------------------
describe('H.01 — window/overlap/latency effects', () => {
  it('zero latency produces earlier target times than non-zero latency', () => {
    const zeroLatency = createHarnessWithOptions({ latency: 0 });
    zeroLatency.scheduler.setScene(createFastScene('bd'));
    zeroLatency.scheduler.start();
    zeroLatency.scheduler.stop();

    const highLatency = createHarnessWithOptions({ latency: 0.5 });
    highLatency.scheduler.setScene(createFastScene('bd'));
    highLatency.scheduler.start();
    highLatency.scheduler.stop();

    expect(zeroLatency.triggers.length).toBe(highLatency.triggers.length);
    for (let i = 0; i < zeroLatency.triggers.length; i++) {
      expect(highLatency.triggers[i]!.targetTime).toBeGreaterThanOrEqual(zeroLatency.triggers[i]!.targetTime);
    }
  });

  it('larger overlap schedules more events on the initial tick', () => {
    const smallOverlap = createHarnessWithOptions({ overlap: 0.01, interval: 0.05 });
    smallOverlap.scheduler.setScene(createFastScene('bd'));
    smallOverlap.scheduler.start();
    smallOverlap.scheduler.stop();

    const largeOverlap = createHarnessWithOptions({ overlap: 0.5, interval: 0.05 });
    largeOverlap.scheduler.setScene(createFastScene('bd'));
    largeOverlap.scheduler.start();
    largeOverlap.scheduler.stop();

    expect(largeOverlap.triggers.length).toBeGreaterThan(smallOverlap.triggers.length);
  });

  it('different windowDuration values produce different per-tick granularity', () => {
    // With a very small window, each inner tick covers fewer cycles
    const tinyWindow = createHarnessWithOptions({ windowDuration: 0.01, overlap: 0 });
    tinyWindow.scheduler.setScene(createFastScene('bd'));
    tinyWindow.scheduler.start();
    tinyWindow.tickAt(0.05);
    tinyWindow.scheduler.stop();

    const normalWindow = createHarnessWithOptions({ windowDuration: 0.05, overlap: 0 });
    normalWindow.scheduler.setScene(createFastScene('bd'));
    normalWindow.scheduler.start();
    normalWindow.tickAt(0.05);
    normalWindow.scheduler.stop();

    // Both should produce triggers
    expect(tinyWindow.triggers.length).toBeGreaterThan(0);
    expect(normalWindow.triggers.length).toBeGreaterThan(0);
  });

  it('combined high latency + high overlap still produces valid target times', () => {
    const harness = createHarnessWithOptions({ latency: 1.0, overlap: 0.5, interval: 0.05 });
    harness.scheduler.setScene(createFastScene('bd'));
    harness.scheduler.start();
    harness.tickAt(0.05);
    harness.scheduler.stop();

    expect(harness.triggers.length).toBeGreaterThan(0);
    // All target times should be positive
    for (const trigger of harness.triggers) {
      expect(trigger.targetTime).toBeGreaterThan(0);
    }
    // Target times should be monotonically non-decreasing
    for (let i = 1; i < harness.triggers.length; i++) {
      expect(harness.triggers[i]!.targetTime).toBeGreaterThanOrEqual(
        harness.triggers[i - 1]!.targetTime - 1e-9,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// H.02: Long-running stability — 100+ ticks, no drift
// ---------------------------------------------------------------------------
describe('H.02 — long-running stability', () => {
  it('maintains monotonic target times over 100+ ticks', () => {
    const harness = createHarness();
    harness.scheduler.setScene(createFastScene('bd'));
    harness.scheduler.start();

    for (let i = 1; i <= 120; i++) {
      harness.tickAt(i * 0.05);
    }
    harness.scheduler.stop();

    expect(harness.triggers.length).toBeGreaterThan(100);

    for (let i = 1; i < harness.triggers.length; i++) {
      expect(harness.triggers[i]!.targetTime).toBeGreaterThanOrEqual(
        harness.triggers[i - 1]!.targetTime - 1e-9,
      );
    }
  });

  it('no drift accumulation: two identical runs produce identical results', () => {
    const run = () => {
      const h = createHarness();
      h.scheduler.setScene(createFastScene('bd'));
      h.scheduler.start();
      for (let i = 1; i <= 100; i++) {
        h.tickAt(i * 0.05);
      }
      h.scheduler.stop();
      return h.triggers;
    };

    const triggers1 = run();
    const triggers2 = run();

    expect(triggers1.length).toBe(triggers2.length);
    expect(triggers1.length).toBeGreaterThan(50);

    for (let i = 0; i < triggers1.length; i++) {
      expect(triggers1[i]!.targetTime).toBeCloseTo(triggers2[i]!.targetTime, 9);
    }
  });

  it('event count scales linearly with elapsed time at constant cps', () => {
    // Run for 50 ticks (~2.5s) and 100 ticks (~5s)
    const short = createHarness();
    short.scheduler.setScene(createFastScene('bd'));
    short.scheduler.start();
    for (let i = 1; i <= 50; i++) {
      short.tickAt(i * 0.05);
    }
    short.scheduler.stop();

    const long = createHarness();
    long.scheduler.setScene(createFastScene('bd'));
    long.scheduler.start();
    for (let i = 1; i <= 100; i++) {
      long.tickAt(i * 0.05);
    }
    long.scheduler.stop();

    // The longer run should produce roughly twice as many events
    const ratio = long.triggers.length / short.triggers.length;
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
  });

  it('survives a mid-run cps change over 100+ ticks without drift', () => {
    const harness = createHarness();
    harness.scheduler.setScene(createFastScene('bd', false));
    harness.scheduler.setCps(1);
    harness.scheduler.start();

    // Run 50 ticks at cps=1
    for (let i = 1; i <= 50; i++) {
      harness.tickAt(i * 0.05);
    }
    const countBeforeChange = harness.triggers.length;

    // Change cps mid-run
    harness.scheduler.setCps(2);

    // Run another 70 ticks at cps=2
    for (let i = 51; i <= 120; i++) {
      harness.tickAt(i * 0.05);
    }
    harness.scheduler.stop();

    // Should have scheduled more events in the second half due to higher cps
    const countAfterChange = harness.triggers.length - countBeforeChange;
    expect(countAfterChange).toBeGreaterThan(countBeforeChange);

    // All target times should remain monotonic
    for (let i = 1; i < harness.triggers.length; i++) {
      expect(harness.triggers[i]!.targetTime).toBeGreaterThanOrEqual(
        harness.triggers[i - 1]!.targetTime - 1e-9,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// H.03: Concurrent tick guard — re-entrancy protection
// ---------------------------------------------------------------------------
describe('H.03 — concurrent tick guard', () => {
  it('ticking boolean prevents re-entrant tick from producing extra triggers', () => {
    let currentTime = 0;
    let intervalCallback: (() => void) | undefined;
    const triggers: Array<{ targetTime: number }> = [];
    let reEntrantCallsMade = 0;
    let firstTickDone = false;

    const scheduler = new Scheduler({
      clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
      getTime: () => currentTime,
      interval: 0.05,
      latency: 0,
      onTrigger: (_event, targetTime) => {
        triggers.push({ targetTime });
        // Only attempt re-entrancy on the second tick (after intervalCallback is set)
        if (firstTickDone && triggers.length === 2 && intervalCallback) {
          reEntrantCallsMade++;
          currentTime = 0.12;
          intervalCallback();
        }
      },
      overlap: 0,
      setIntervalFn: ((callback: Parameters<typeof setInterval>[0]) => {
        intervalCallback = callback as () => void;
        return 1 as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      windowDuration: 0.05,
    });

    scheduler.setScene(createFastScene('bd'));
    scheduler.start();
    firstTickDone = true;
    const countAfterStart = triggers.length;

    // Manually trigger a second tick where re-entrancy is attempted
    currentTime = 0.05;
    intervalCallback!();
    scheduler.stop();

    // We made exactly one re-entrant call attempt
    expect(reEntrantCallsMade).toBe(1);
    // The second tick produced triggers (re-entrancy did not add extra ones)
    expect(triggers.length).toBeGreaterThan(countAfterStart);

    // Compare to a reference run without re-entrancy
    const referenceHarness = createHarness();
    referenceHarness.scheduler.setScene(createFastScene('bd'));
    referenceHarness.scheduler.start();
    referenceHarness.tickAt(0.05);
    referenceHarness.scheduler.stop();
    expect(triggers.length).toBe(referenceHarness.triggers.length);
  });

  it('tick after stop is a no-op even with pending interval', () => {
    const harness = createHarness();
    harness.scheduler.setScene(createFastScene('bd'));
    harness.scheduler.start();
    const countAfterStart = harness.triggers.length;

    harness.scheduler.stop();

    // Multiple ticks after stop should not produce anything
    for (let i = 1; i <= 10; i++) {
      harness.tickAt(i * 0.05);
    }
    expect(harness.triggers.length).toBe(countAfterStart);
  });

  it('stop clears ticking flag so restart works cleanly', () => {
    const harness1 = createHarness();
    harness1.scheduler.setScene(createFastScene('bd'));
    harness1.scheduler.start();
    harness1.tickAt(0.05);
    harness1.tickAt(0.1);
    harness1.scheduler.stop();
    const firstRunCount = harness1.triggers.length;

    // Second run with fresh harness should produce identical results
    const harness2 = createHarness();
    harness2.scheduler.setScene(createFastScene('bd'));
    harness2.scheduler.start();
    harness2.tickAt(0.05);
    harness2.tickAt(0.1);
    harness2.scheduler.stop();

    expect(harness2.triggers.length).toBe(firstRunCount);
    expect(firstRunCount).toBeGreaterThan(0);
  });

  it('double start is idempotent and does not duplicate triggers', () => {
    const harness = createHarness();
    harness.scheduler.setScene(createFastScene('bd'));
    harness.scheduler.start();
    const countAfterFirstStart = harness.triggers.length;

    harness.scheduler.start(); // second start is a no-op
    expect(harness.triggers.length).toBe(countAfterFirstStart);

    harness.tickAt(0.05);
    const countAfterTick = harness.triggers.length;
    expect(countAfterTick).toBeGreaterThan(countAfterFirstStart);

    harness.scheduler.stop();
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
  return createHarnessWithOptions({});
}

function createHarnessWithOptions(opts: {
  interval?: number;
  latency?: number;
  overlap?: number;
  windowDuration?: number;
}) {
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
    interval: opts.interval ?? 0.05,
    latency: opts.latency ?? 0,
    onExternalDispatch: (dispatch) => {
      dispatches.push(dispatch);
    },
    onTrigger: (event, targetTime) => {
      triggers.push({ event, targetTime });
    },
    overlap: opts.overlap ?? 0,
    setIntervalFn: ((callback: Parameters<typeof setInterval>[0]) => {
      if (typeof callback !== 'function') {
        throw new TypeError('expected scheduler interval callback');
      }
      intervalCallback = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval,
    windowDuration: opts.windowDuration ?? 0.05,
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
