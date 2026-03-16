/**
 * Real-time event scheduler that drives pattern playback.
 *
 * Queries a scene at regular intervals and dispatches events to an onTrigger
 * callback at the correct wall-clock time. Supports dynamic CPS changes,
 * MIDI/OSC external dispatch, and configurable lookahead/overlap windows.
 */

import { createLogger, type SceneSpec, TusselCoreError } from '@tussel/ir';
import type { ExternalDispatchEvent, PlaybackEvent, SchedulerOptions } from './types.js';

// Import from index at call-time only (no circular dep at module init)
import { collectExternalDispatches, evaluateNumericValue, queryScene } from './index.js';

const schedulerLogger = createLogger('tussel/core');

// ---------------------------------------------------------------------------
// Named constants — scheduler timing defaults
// ---------------------------------------------------------------------------

/**
 * Default duration of each scheduling window (tick quantum) in seconds.
 *
 * Controls how many cycles of audio are queried per tick. Smaller values give
 * finer temporal granularity; larger values reduce timer overhead. 50 ms is a
 * pragmatic middle ground: small enough for responsive live-coding, large
 * enough to avoid excessive per-tick work.
 */
const DEFAULT_WINDOW_DURATION_S = 0.05;

/**
 * Default scheduler setInterval period in seconds.
 *
 * How often the scheduler wakes up to query and dispatch events. 100 ms
 * balances low latency against CPU cost. Must be > 0.
 */
const DEFAULT_INTERVAL_S = 0.1;

/**
 * Default extra lookahead beyond the interval, in seconds.
 *
 * Provides an overlap buffer that prevents gaps between ticks when the
 * timer fires slightly late. Together with `DEFAULT_INTERVAL_S`, determines
 * the total scheduling horizon: `interval + overlap`.
 */
const DEFAULT_OVERLAP_S = 0.1;

/**
 * Default fixed latency offset added to event target times, in seconds.
 *
 * Compensates for the delay between JS scheduling and actual audio output.
 * Higher values improve reliability on slow systems but add perceptible delay.
 */
const DEFAULT_LATENCY_S = 0.1;

/**
 * Phase offset applied on the very first tick to avoid scheduling events at
 * exactly `now`, in seconds.
 *
 * A tiny forward nudge (10 ms) ensures the audio context has time to prepare
 * before the first event fires. Without this, the first note can be clipped
 * or missed entirely on some audio backends.
 */
const INITIAL_PHASE_OFFSET_S = 0.01;

/**
 * Minimum allowed target time offset from `now`, in seconds.
 *
 * When an event's computed target time falls in the past (or essentially at
 * `now`), it is clamped to `now + MIN_TARGET_TIME_OFFSET_S`. The 1 ms floor
 * prevents scheduling at time zero, which can cause clicks/glitches in the
 * Web Audio API.
 */
const MIN_TARGET_TIME_OFFSET_S = 0.001;

/**
 * Maximum number of scheduling windows processed in a single tick.
 *
 * Prevents unbounded catch-up bursts when the scheduler falls behind
 * (e.g. if the event loop was blocked). Without this cap, a long pause
 * followed by a tick would try to process all missed windows at once,
 * creating a CPU spike that could cause further scheduling problems.
 * 20 windows at 50 ms each = 1 second of catch-up per tick.
 */
const MAX_WINDOWS_PER_TICK = 20;

export class Scheduler {
  private clearIntervalFn: NonNullable<SchedulerOptions['clearIntervalFn']>;
  private cycleAtCpsChange = 0;
  private dispatchErrorCount = 0;
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private lastBegin = 0;
  private lastEnd = 0;
  private lastTick = 0;
  private numTicksSinceCpsChange = 0;
  /** Number of currently pending (unresolved) async onTrigger/onExternalDispatch calls. */
  private pendingAsyncCount = 0;
  private scene: SceneSpec | undefined;
  private secondsAtCpsChange = 0;
  private setIntervalFn: NonNullable<SchedulerOptions['setIntervalFn']>;
  private ticking = false;
  started = false;
  cps = 0.5;

  constructor(private readonly options: SchedulerOptions) {
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
  }

  now(): number {
    if (!this.started) {
      return 0;
    }
    const secondsSinceLastTick =
      this.options.getTime() - this.lastTick - (this.options.windowDuration ?? DEFAULT_WINDOW_DURATION_S);
    return this.lastBegin + secondsSinceLastTick * this.cps;
  }

  setCps(cps: number): void {
    if (!Number.isFinite(cps) || cps <= 0) {
      throw new RangeError(`Scheduler.setCps() requires a positive finite number, received ${cps}.`);
    }
    if (cps === this.cps) {
      return;
    }
    this.cps = cps;
    this.numTicksSinceCpsChange = 0;
  }

  setScene(scene: SceneSpec): void {
    this.scene = scene;
    const transportCps = resolveTransportCps(scene, this.now());
    if (transportCps !== undefined) {
      this.setCps(transportCps);
    }
  }

  start(): void {
    if (this.started) {
      return;
    }
    if (!this.scene) {
      throw new TusselCoreError('Scheduler requires a scene before start', {
        code: 'TUSSEL_SCHEDULER_NO_SCENE',
      });
    }
    this.started = true;
    this.tick();
    this.intervalHandle = this.setIntervalFn(this.tick, (this.options.interval ?? DEFAULT_INTERVAL_S) * 1000);
  }

  stop(): void {
    if (this.intervalHandle) {
      this.clearIntervalFn(this.intervalHandle);
    }
    this.intervalHandle = undefined;
    this.started = false;
    this.ticking = false;
    this.lastBegin = 0;
    this.lastEnd = 0;
    this.lastTick = 0;
    this.numTicksSinceCpsChange = 0;
    this.dispatchErrorCount = 0;
    this.pendingAsyncCount = 0;
  }

  /** Number of currently in-flight async trigger/dispatch callbacks. */
  get pendingAsync(): number {
    return this.pendingAsyncCount;
  }

  private logDispatchError(source: string, error: unknown): void {
    this.dispatchErrorCount += 1;
    const message = error instanceof Error ? error.message : String(error);
    schedulerLogger.errorOnce(`dispatch:${source}`, `${source} error: ${message}`);
  }

  /**
   * Track an async callback promise. Increments pendingAsyncCount on start,
   * decrements on settlement (resolve or reject). Errors are logged via
   * logDispatchError.
   */
  private trackAsync(source: string, promise: Promise<unknown>): void {
    this.pendingAsyncCount += 1;
    promise
      .catch((error) => this.logDispatchError(source, error))
      .finally(() => {
        this.pendingAsyncCount -= 1;
      });
  }

  private tick = (): void => {
    if (!this.scene || !this.started || this.ticking) {
      return;
    }
    this.ticking = true;

    const getTime = this.options.getTime;
    const duration = this.options.windowDuration ?? DEFAULT_WINDOW_DURATION_S;
    const interval = this.options.interval ?? DEFAULT_INTERVAL_S;
    const overlap = this.options.overlap ?? DEFAULT_OVERLAP_S;
    const latency = this.options.latency ?? DEFAULT_LATENCY_S;
    const now = getTime();
    const lookahead = now + interval + overlap;
    let phase = this.lastTick === 0 ? now + INITIAL_PHASE_OFFSET_S : this.lastTick + duration;

    // Drift compensation: if phase has fallen too far behind the wall clock
    // (e.g. the event loop was blocked), skip forward to avoid processing
    // stale windows. We keep at most MAX_WINDOWS_PER_TICK windows of backlog.
    const maxBacklog = MAX_WINDOWS_PER_TICK * duration;
    if (phase < now - maxBacklog) {
      schedulerLogger.warnOnce(
        'scheduler:drift',
        `Scheduler fell behind wall clock by ${((now - phase) * 1000).toFixed(0)} ms — skipping stale windows.`,
      );
      phase = now - maxBacklog;
    }

    let windowsProcessed = 0;
    while (phase < lookahead && windowsProcessed < MAX_WINDOWS_PER_TICK) {
      windowsProcessed += 1;
      if (this.numTicksSinceCpsChange === 0) {
        this.cycleAtCpsChange = this.lastEnd;
        this.secondsAtCpsChange = phase;
      }

      this.numTicksSinceCpsChange += 1;
      const secondsSinceCpsChange = this.numTicksSinceCpsChange * duration;
      const begin = this.lastEnd;
      const end = this.cycleAtCpsChange + secondsSinceCpsChange * this.cps;
      this.lastBegin = begin;
      this.lastEnd = end;
      this.lastTick = phase;

      const transportCps = resolveTransportCps(this.scene, begin);
      if (transportCps !== undefined && transportCps !== this.cps) {
        this.setCps(transportCps);
      }

      const events = queryScene(this.scene, begin, end, { cps: this.cps });
      for (const event of events) {
        const rawTargetTime =
          (event.begin - this.cycleAtCpsChange) / this.cps + this.secondsAtCpsChange + latency;
        const targetTime = Math.max(rawTargetTime, now + MIN_TARGET_TIME_OFFSET_S);
        for (const dispatch of collectExternalDispatches(event, targetTime)) {
          try {
            const result = this.options.onExternalDispatch?.(dispatch, targetTime);
            if (result instanceof Promise) {
              this.trackAsync('onExternalDispatch', result);
            }
          } catch (error) {
            this.logDispatchError('onExternalDispatch', error);
          }
        }
        try {
          const result = this.options.onTrigger(event, targetTime);
          if (result instanceof Promise) {
            this.trackAsync('onTrigger', result);
          }
        } catch (error) {
          this.logDispatchError('onTrigger', error);
        }
      }

      phase += duration;
    }
    this.ticking = false;
  };
}

function resolveTransportCps(scene: SceneSpec, cycle: number): number | undefined {
  const cps = evaluateNumericValue(scene.transport.cps, cycle);
  if (cps !== undefined && Number.isFinite(cps) && cps > 0) {
    return cps;
  }

  const bpm = evaluateNumericValue(scene.transport.bpm, cycle);
  if (bpm !== undefined && Number.isFinite(bpm) && bpm > 0) {
    return bpm / 60;
  }

  return undefined;
}
