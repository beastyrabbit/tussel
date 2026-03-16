/**
 * Public type definitions for the Tussel core engine.
 */

export interface PlaybackEvent {
  begin: number;
  channel: string;
  duration: number;
  end: number;
  payload: Record<string, unknown>;
}

export interface QueryContext {
  cps: number;
}

interface ExternalDispatchEventBase {
  begin: number;
  channel: string;
  end: number;
  payload: Record<string, unknown>;
  targetTime?: number;
}

export interface MidiNoteDispatchEvent extends ExternalDispatchEventBase {
  channelNumber: number;
  kind: 'midi-note';
  note: number;
  port: string;
  velocity: number;
}

export interface MidiCcDispatchEvent extends ExternalDispatchEventBase {
  channelNumber: number;
  control: number;
  kind: 'midi-cc';
  port: string;
  value: number;
}

export interface MidiCommandDispatchEvent extends ExternalDispatchEventBase {
  command: number | string;
  kind: 'midi-command';
  port: string;
}

export interface MidiPitchBendDispatchEvent extends ExternalDispatchEventBase {
  channelNumber: number;
  kind: 'midi-pitch-bend';
  port: string;
  value: number;
}

export interface MidiTouchDispatchEvent extends ExternalDispatchEventBase {
  channelNumber: number;
  kind: 'midi-touch';
  port: string;
  value: number;
}

export interface OscDispatchEvent extends ExternalDispatchEventBase {
  host: string;
  kind: 'osc';
  path: string;
  port: number;
}

export type ExternalDispatchEvent =
  | MidiCcDispatchEvent
  | MidiCommandDispatchEvent
  | MidiNoteDispatchEvent
  | MidiPitchBendDispatchEvent
  | MidiTouchDispatchEvent
  | OscDispatchEvent;

export interface SchedulerOptions {
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
  getTime: () => number;
  /**
   * How often the scheduler's setInterval fires, in seconds.
   * Default: 0.1 (100 ms). Lower values reduce latency at the cost of more
   * frequent timer callbacks. Must be > 0.
   */
  interval?: number;
  /**
   * Fixed lookahead offset added to event target times, in seconds.
   * Default: 0.1 (100 ms). Compensates for the delay between scheduling
   * and actual audio output. Higher values increase reliability on slow
   * systems but add perceptible delay.
   */
  latency?: number;
  onExternalDispatch?: (dispatch: ExternalDispatchEvent, targetTime: number) => void | Promise<void>;
  onTrigger: (event: PlaybackEvent, targetTime: number) => void | Promise<void>;
  /**
   * Extra lookahead beyond the interval to prevent gaps between ticks, in
   * seconds. Default: 0.1 (100 ms). Together with `interval`, determines
   * the total scheduling horizon: `interval + overlap`.
   */
  overlap?: number;
  setIntervalFn?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
  /**
   * Duration of each scheduling window (tick quantum) in seconds.
   * Default: 0.05 (50 ms). Controls how many cycles of audio are queried
   * per tick. Smaller windows give finer granularity; larger windows
   * reduce overhead.
   */
  windowDuration?: number;
}
