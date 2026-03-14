import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clampNumber,
  edoFrequency,
  type ExternalDispatchEvent,
  parseXenValue,
  type PlaybackEvent,
  queryScene,
  Scheduler,
} from '@tussel/core';
import { getCsoundInstrument, type SampleManifest, type SceneSpec, TusselAudioError } from '@tussel/ir';
import { type MidiOutputFactory, MidiOutputManager, loadMidiOutputFactory } from './midi-output.js';
import { OscOutputManager } from './osc-output.js';
import type {
  AudioBuffer,
  AudioBufferSourceNode,
  AudioContext,
  AudioNode,
  OfflineAudioContext,
} from 'node-web-audio-api';
import {
  BiquadFilterNode,
  AudioBufferSourceNode as BufferSourceNode,
  ConvolverNode,
  DelayNode,
  GainNode,
  OfflineAudioContext as OfflineContext,
  OscillatorNode,
  AudioContext as RealtimeAudioContext,
  StereoPannerNode,
  WaveShaperNode,
} from 'node-web-audio-api';
import pc from 'picocolors';

type AnyContext = AudioContext | OfflineAudioContext;

interface SampleAsset {
  basePath: string;
  files: string[];
}

interface SampleManifestCacheEntry {
  manifest: SampleManifest;
  rootDir: string;
}

interface LoadedVoice {
  gate: GainNode;
  sources: Array<AudioBufferSourceNode | OscillatorNode>;
}

interface MixGraph {
  masterInput: GainNode;
  orbitInputs: Map<string, GainNode>;
}

interface EnvelopeDefaults {
  attack: number;
  decay: number;
  peak: number;
  release: number;
  sustain: number;
}

type CsoundPreset = 'analog' | 'drum' | 'fm' | 'noise' | 'organ' | 'pad' | 'pluck';

export interface CsoundVoiceSpec {
  controls: string;
  duration: number;
  frequency: number;
  gain: number;
  instrument: string;
  knownInstrument: boolean;
  midiKey: number;
  mode: 'frequency' | 'midi';
  preset: CsoundPreset;
  velocity: number;
}

const BUILTIN_SYNTHS = new Set(['noise', 'saw', 'sawtooth', 'sine', 'square', 'triangle']);

// -- Default constants: audio engine configuration ----------------------------

/**
 * Oscillator waveform used when a note is triggered without an explicit sound
 * name (e.g. `note("c3")`).
 *
 * Valid values: any OscillatorType (`'sine'`, `'square'`, `'sawtooth'`, `'triangle'`).
 * Triangle is chosen for its mellow, general-purpose timbre.
 */
const DEFAULT_NOTE_SYNTH = 'triangle';

/**
 * ADSR envelope applied to sample playback.
 *
 * - attack / decay / release: seconds (range 0.001 - 4).
 * - peak: linear gain multiplier (range 0 - 2).
 * - sustain: fraction of peak (range 0 - 1).
 *
 * Near-zero attack/decay give an immediate onset suitable for percussive
 * samples. Sustain of 1 means no level drop after decay. Empirically tuned.
 */
const DEFAULT_SAMPLE_ENVELOPE: EnvelopeDefaults = {
  attack: 0.001,
  decay: 0.001,
  peak: 0.8,
  release: 0.01,
  sustain: 1,
};

/**
 * ADSR envelope applied to synthesizer oscillator voices.
 *
 * - attack / decay / release: seconds (range 0.001 - 4).
 * - peak: linear gain multiplier (range 0 - 2).
 * - sustain: fraction of peak (range 0 - 1).
 *
 * Slightly longer decay (0.05 s) and lower sustain (0.6) than the sample
 * envelope for a natural pluck-like contour. Empirically tuned.
 */
const DEFAULT_SYNTH_ENVELOPE: EnvelopeDefaults = {
  attack: 0.001,
  decay: 0.05,
  peak: 0.8,
  release: 0.01,
  sustain: 0.6,
};

/** Output gain for built-in synth voices (range 0-1). Below unity to leave headroom when layering. Empirically tuned. */
const DEFAULT_SYNTH_OUTPUT_GAIN = 0.3;

/** Default delay time in cycles (converted to seconds via cycles/cps). Range: >0. Quarter-cycle is musically common. */
const DEFAULT_DELAY_CYCLES = 0.25;

/** Fraction of delayed signal fed back into delay line. Range: 0 - MAX_DELAY_FEEDBACK. Empirically tuned. */
const DEFAULT_DELAY_FEEDBACK = 0.35;

/** Maximum delay time in seconds. Caps DelayNode.maxDelayTime to avoid excessive memory. */
const DEFAULT_DELAY_MAX_SECONDS = 4;

/** FM synthesis modulation depth multiplier. Applied as carrierFreq * depth * DEFAULT_FM_DEPTH. Empirically tuned. */
const DEFAULT_FM_DEPTH = 4;

/** Ratio of FM modulator frequency to carrier. 0.5 (octave below) gives rich harmonics without dissonance. Empirically tuned. */
const DEFAULT_FM_RATIO = 0.5;

/** Feedback gain for phaser all-pass chain. Range: 0 - 0.85. Empirically tuned for a subtle effect. */
const DEFAULT_PHASER_FEEDBACK = 0.35;

/** LFO rate in Hz for phaser sweep (~5.5 s cycle). Empirically tuned for gentle modulation. */
const DEFAULT_PHASER_RATE = 0.18;

/** Default reverb room size (seconds of tail). Range: 0.05 - 8. Value of 2 gives a medium room. Empirically tuned. */
const DEFAULT_ROOM_SIZE = 2;

/** Output gain for Csound-emulated voices (range 0-1). Lower than synth gain to compensate for hotter presets. Empirically tuned. */
const DEFAULT_CSOUND_OUTPUT_GAIN = 0.25;

// -- Extracted audio constants ------------------------------------------------

/** Near-zero gain for end of release ramp. Avoids issues with linearRampToValueAtTime(0) while being inaudible. */
const ENVELOPE_RELEASE_FLOOR = 0.0001;

/** Human hearing range upper bound in Hz. Used to clamp filter frequencies. */
const MAX_AUDIBLE_FREQUENCY_HZ = 20_000;

/** Max delay feedback. Must stay below 1.0 to prevent runaway self-oscillation. */
const MAX_DELAY_FEEDBACK = 0.98;

/** Maximum MIDI value (7-bit, 0-indexed). Used for velocity, note, and CC conversions. */
const MIDI_MAX_VALUE = 127;

/** Human hearing range lower bound in Hz. Used to clamp filter frequencies. */
const MIN_AUDIBLE_FREQUENCY_HZ = 20;

/** Minimum CPS divisor to prevent division by zero when converting cycles to seconds. */
const MIN_CPS_DIVISOR = 0.01;

/** Minimum delay time in seconds. Prevents comb-filter artifacts from very short delays. */
const MIN_DELAY_TIME_SECONDS = 0.02;

/** Minimum note/sample duration in seconds. Prevents clicks from near-zero-length events. Empirically tuned. */
const MIN_NOTE_DURATION_SECONDS = 0.05;

/** Minimum playback duration in seconds. Prevents degenerate playback windows. */
const MIN_PLAYBACK_DURATION_SECONDS = 0.01;

/** Minimum playback rate for sample sources. Prevents stalling from zero rate. */
const MIN_PLAYBACK_RATE = 1e-3;

/** Duration of pre-generated white-noise buffer (seconds). One second is enough randomness to loop naturally. */
const NOISE_BUFFER_SECONDS = 1;

/** Padding after release phase (seconds). Ensures gain envelope fully decays before source stops. Empirically tuned. */
const STOP_TIME_PADDING_SECONDS = 0.01;
const impulseResponseCache = new WeakMap<AnyContext, Map<string, AudioBuffer>>();
const reversedBufferCache = new WeakMap<AudioBuffer, AudioBuffer>();
const warnedMissingSamples = new Set<string>();
const warnedUnknownCsoundInstruments = new Set<string>();

export interface RealtimeAudioEngineOptions {
  cacheDir?: string;
  onExternalDispatch?: (dispatch: ExternalDispatchEvent, targetTime: number) => void | Promise<void>;
  sinkless?: boolean;
}

export class RealtimeAudioEngine {
  private readonly cacheDir: string;
  private context: AudioContext | undefined;
  private readonly cutGroups = new Map<string, LoadedVoice[]>();
  readonly midiOutput: MidiOutputManager | undefined;
  private mixGraph: MixGraph | undefined;
  private readonly onExternalDispatch: RealtimeAudioEngineOptions['onExternalDispatch'];
  readonly oscOutput = new OscOutputManager();
  private readonly sampleRegistry = new SampleRegistry();
  private scheduler: Scheduler | undefined;

  constructor(options: RealtimeAudioEngineOptions = {}) {
    this.cacheDir = options.cacheDir ?? path.resolve('.tussel-cache', 'samples');
    this.onExternalDispatch = options.onExternalDispatch;
    this.sinkless = options.sinkless ?? process.env.TUSSEL_SINK === 'none';
  }

  private readonly sinkless: boolean;

  async start(scene: SceneSpec): Promise<void> {
    if (!this.context) {
      this.context = await createRealtimeContext(this.sinkless);
    }

    await this.initMidi();

    await this.sampleRegistry.prepareScene(scene, this.cacheDir);
    this.mixGraph = createMixGraph(
      this.context,
      scene,
      typeof scene.transport.cps === 'number' ? scene.transport.cps : 0.5,
    );

    this.scheduler ??= new Scheduler({
      getTime: () => this.context?.currentTime ?? 0,
      onExternalDispatch: (dispatch, targetTime) => {
        if (dispatch.kind === 'osc') {
          this.oscOutput.dispatchEvent(dispatch);
        } else if (dispatch.kind === 'midi-note' || dispatch.kind === 'midi-cc') {
          this.handleMidiDispatch(dispatch, targetTime);
        }
        return this.onExternalDispatch?.(dispatch, targetTime);
      },
      onTrigger: (event, targetTime) => this.trigger(event, targetTime),
    });
    this.scheduler.setScene(scene);
    this.scheduler.start();
  }

  async updateScene(scene: SceneSpec): Promise<void> {
    if (!this.context || !this.scheduler) {
      await this.start(scene);
      return;
    }

    await this.sampleRegistry.prepareScene(scene, this.cacheDir);
    this.mixGraph = createMixGraph(
      this.context,
      scene,
      typeof scene.transport.cps === 'number' ? scene.transport.cps : this.scheduler.cps,
    );
    this.scheduler.setScene(scene);
  }

  async stop(): Promise<void> {
    this.scheduler?.stop();
    this.scheduler = undefined;
    this.oscOutput.closeAll();
    this.midiOutput?.closeAll();

    if (this.context) {
      await this.context.close();
      this.context = undefined;
      this.mixGraph = undefined;
    }
  }

  /**
   * Lazily initialize the MidiOutputManager if the native addon is available.
   * Called once from `start()`. Subsequent calls are a no-op.
   */
  private async initMidi(): Promise<void> {
    if (this.midiOutput !== undefined) {
      return;
    }
    const factory = await loadMidiOutputFactory();
    if (factory) {
      // Cast away readonly for one-time initialization
      (this as { midiOutput: MidiOutputManager | undefined }).midiOutput = new MidiOutputManager(factory);
    }
  }

  /**
   * Handle a MIDI dispatch event. For note events, schedules the Note Off
   * after the event's duration using `setTimeout`.
   */
  private handleMidiDispatch(
    dispatch: import('@tussel/core').MidiNoteDispatchEvent | import('@tussel/core').MidiCcDispatchEvent,
    targetTime: number,
  ): void {
    if (!this.midiOutput) {
      return;
    }

    const noteOff = this.midiOutput.dispatchEvent(dispatch);

    if (noteOff && dispatch.kind === 'midi-note') {
      // Schedule note-off after the event's duration.
      // The duration is (end - begin) in cycle units; convert to seconds
      // using the scheduler's cps (cycles per second).
      const cps = this.scheduler?.cps ?? 0.5;
      const durationSeconds = Math.max(0.01, (dispatch.end - dispatch.begin) / cps);

      // Account for the lookahead: targetTime is in AudioContext time,
      // currentTime is "now". The note-on was sent immediately but should
      // conceptually start at targetTime, so the note-off delay is relative
      // to now.
      const now = this.context?.currentTime ?? 0;
      const delayMs = Math.max(10, (targetTime - now + durationSeconds) * 1000);

      setTimeout(noteOff, delayMs);
    }
  }

  private async trigger(event: PlaybackEvent, targetTime: number): Promise<void> {
    if (!this.context || event.payload.mute) {
      return;
    }

    try {
      const voice = await buildVoice(
        this.context,
        this.mixGraph ??
          createMixGraph(
            this.context,
            { channels: {}, samples: [], transport: {} },
            this.scheduler?.cps ?? 0.5,
          ),
        this.sampleRegistry,
        event,
        targetTime,
        this.scheduler?.cps ?? 0.5,
      );
      if (!voice) {
        return;
      }
      applyCutGroup(this.cutGroups, event, voice, targetTime);
    } catch (error) {
      const audioError =
        error instanceof TusselAudioError
          ? error
          : new TusselAudioError(`audio trigger failed: ${(error as Error).message}`, { cause: error });
      console.error(pc.red(audioError.message));
    }
  }
}

export async function renderSceneToFile(
  scene: SceneSpec,
  outputPath: string,
  seconds = 8,
  cacheDir = path.resolve('.tussel-cache', 'samples'),
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await renderSceneToWavBuffer(scene, { cacheDir, seconds }));
}

export async function renderSceneToWavBuffer(
  scene: SceneSpec,
  options: {
    cacheDir?: string;
    sampleRate?: number;
    seconds: number;
  },
): Promise<Buffer> {
  const sampleRate = options.sampleRate ?? 48_000;
  const seconds = options.seconds;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new RangeError(`renderSceneToWavBuffer() requires seconds > 0, received ${seconds}.`);
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`renderSceneToWavBuffer() requires sampleRate > 0, received ${sampleRate}.`);
  }
  const cacheDir = options.cacheDir ?? path.resolve('.tussel-cache', 'samples');
  const context = new OfflineContext(2, Math.max(1, Math.ceil(sampleRate * seconds)), sampleRate);
  const registry = new SampleRegistry();
  await registry.prepareScene(scene, cacheDir);
  const cps = typeof scene.transport.cps === 'number' ? scene.transport.cps : 0.5;
  const mixGraph = createMixGraph(context, scene, cps);
  const events = queryScene(scene, 0, seconds * cps, { cps });
  const cutGroups = new Map<string, LoadedVoice[]>();
  for (const event of events) {
    const targetTime = event.begin / cps;
    const voice = await buildVoice(context, mixGraph, registry, event, targetTime, cps);
    if (!voice) {
      continue;
    }
    applyCutGroup(cutGroups, event, voice, targetTime);
  }
  const rendered = await context.startRendering();
  return audioBufferToWav(rendered);
}

export async function ensureSamplePackLocal(
  ref: string,
  cacheDir = path.resolve('.tussel-cache', 'samples'),
): Promise<string> {
  const manifest = await resolveManifest(ref, cacheDir);
  return manifest.rootDir;
}

/**
 * Extended options accepted by node-web-audio-api's AudioContext constructor.
 * The upstream DOM lib omits `sinkId` but the runtime supports it to create
 * a context with no audio output device.
 */
interface SinklessAudioContextOptions extends AudioContextOptions {
  sinkId: { type: 'none' };
}

async function createRealtimeContext(sinkless: boolean): Promise<AudioContext> {
  try {
    if (sinkless) {
      return new RealtimeAudioContext({
        latencyHint: 'playback',
        sinkId: { type: 'none' },
      } as SinklessAudioContextOptions);
    }
    return new RealtimeAudioContext({ latencyHint: 'playback' });
  } catch {
    return new RealtimeAudioContext({
      latencyHint: 'playback',
      sinkId: { type: 'none' },
    } as SinklessAudioContextOptions);
  }
}

async function buildVoice(
  context: AnyContext,
  mixGraph: MixGraph,
  registry: SampleRegistry,
  event: PlaybackEvent,
  targetTime: number,
  cps: number,
): Promise<LoadedVoice | undefined> {
  const clipValue = coerceFiniteNumber(event.payload.clip);
  const clippedEvent =
    clipValue !== undefined && clipValue !== 1
      ? { ...event, duration: event.duration * Math.max(clipValue, 0) }
      : event;

  const csoundVoice = playCsound(context, mixGraph, clippedEvent, targetTime, cps);
  if (csoundVoice) {
    return csoundVoice;
  }

  const soundName = resolveSoundName(clippedEvent.payload);
  if (!soundName) {
    return undefined;
  }

  if (BUILTIN_SYNTHS.has(soundName)) {
    return playSynth(context, mixGraph, soundName, clippedEvent, targetTime, cps);
  }

  const sample = await registry.getSample(
    context,
    soundName,
    clippedEvent.payload.bank,
    clippedEvent.payload.n,
  );
  if (!sample) {
    if (soundName !== 'silence' && !warnedMissingSamples.has(soundName)) {
      warnedMissingSamples.add(soundName);
      const audioError = new TusselAudioError(`sample not found: ${soundName}`, {
        code: 'TUSSEL_AUDIO_SAMPLE_NOT_FOUND',
        details: { soundName },
      });
      console.warn(pc.yellow(audioError.message));
    }
    return undefined;
  }
  return playSample(context, mixGraph, sample, clippedEvent, targetTime, cps);
}

export function resolveCsoundVoiceSpec(event: PlaybackEvent, cps: number): CsoundVoiceSpec | undefined {
  const mode =
    event.payload.csoundm !== undefined
      ? 'midi'
      : event.payload.csound !== undefined
        ? 'frequency'
        : undefined;
  if (!mode) {
    return undefined;
  }

  const instrumentValue = (mode === 'midi' ? event.payload.csoundm : event.payload.csound) ?? 'triangle';
  const instrument = `${instrumentValue}`.trim();
  if (!instrument) {
    return undefined;
  }

  const definition = getCsoundInstrument(instrument);
  const frequency = resolveFrequency(event.payload);
  const gain = clampNumber(event.payload.gain, 0, 1, 0.8);
  const velocityBase = clampNumber(event.payload.velocity, 0, 1, 0.9);
  const duration = Math.max(event.duration / Math.max(cps, MIN_CPS_DIVISOR), MIN_PLAYBACK_DURATION_SECONDS);
  const controls = Object.entries({
    ...event.payload,
    frequency,
  })
    .filter(([key]) => key !== 'csound' && key !== 'csoundm')
    .flat()
    .join('/');

  return {
    controls,
    duration,
    frequency,
    gain,
    instrument,
    knownInstrument: !!definition || typeof instrumentValue === 'number',
    midiKey: frequencyToMidi(frequency),
    mode,
    preset: resolveCsoundPreset(instrument, definition?.body),
    velocity: MIDI_MAX_VALUE * gain * velocityBase,
  };
}

function resolveSoundName(payload: Record<string, unknown>): string | undefined {
  const source = payload.sound ?? payload.s;
  if (typeof source === 'string') {
    const resolved = source.split(':')[0]?.trim();
    if (resolved) {
      return resolved;
    }
  }

  if (hasPitchPayload(payload)) {
    return DEFAULT_NOTE_SYNTH;
  }
  return undefined;
}

function hasPitchPayload(payload: Record<string, unknown>): boolean {
  const note = payload.note;
  if (typeof note === 'number') {
    return Number.isFinite(note);
  }
  if (typeof note === 'string') {
    return note.trim().length > 0;
  }
  return false;
}

async function playSample(
  context: AnyContext,
  mixGraph: MixGraph,
  buffer: AudioBuffer,
  event: PlaybackEvent,
  targetTime: number,
  cps: number,
): Promise<LoadedVoice> {
  const env = createEnvelope(context, event, targetTime, cps, DEFAULT_SAMPLE_ENVELOPE);
  const requestedSpeed = coerceFiniteNumber(event.payload.speed) ?? 1;
  const playbackRate = Math.max(Math.abs(requestedSpeed), MIN_PLAYBACK_RATE);
  const reverse = requestedSpeed < 0;
  const sourceBuffer = reverse ? getReversedBuffer(context, buffer) : buffer;
  const begin = clampNumber(event.payload.begin, 0, 0.99, 0);
  const end = clampNumber(event.payload.end, begin + MIN_PLAYBACK_DURATION_SECONDS, 1, 1);
  const loopEnabled = isLoopEnabled(event.payload.loop);
  const loopStart = reverse ? (1 - end) * buffer.duration : begin * buffer.duration;
  const loopEnd = reverse ? (1 - begin) * buffer.duration : end * buffer.duration;
  const source = new BufferSourceNode(context, {
    buffer: sourceBuffer,
    loop: loopEnabled,
    loopEnd,
    loopStart,
    playbackRate,
  });
  const availableDuration = Math.max(buffer.duration * (end - begin), MIN_PLAYBACK_DURATION_SECONDS);
  const offset = loopStart;
  const playbackWindow = Math.max(event.duration / cps, MIN_PLAYBACK_DURATION_SECONDS);
  const sampleWindow = availableDuration / playbackRate;
  const duration = loopEnabled ? playbackWindow : Math.min(sampleWindow, playbackWindow);
  const stopTime =
    targetTime + Math.max(duration, MIN_NOTE_DURATION_SECONDS) + env.release + STOP_TIME_PADDING_SECONDS;
  const destination = connectOutputChain(
    context,
    env,
    event.payload,
    cps,
    resolveOrbitDestination(context, mixGraph, event.payload.orbit),
    { startTime: targetTime, stopTime },
  );
  source.connect(destination);
  source.start(targetTime, offset);
  source.stop(stopTime);
  return { gate: env, sources: [source] };
}

function applyCutGroup(
  cutGroups: Map<string, LoadedVoice[]>,
  event: PlaybackEvent,
  voice: LoadedVoice,
  targetTime: number,
): void {
  const cut = event.payload.cut;
  if (typeof cut !== 'string' && typeof cut !== 'number') {
    return;
  }

  const key = `${cut}`;
  const active = cutGroups.get(key) ?? [];
  for (const entry of active) {
    entry.gate.gain.cancelScheduledValues(targetTime);
    entry.gate.gain.setValueAtTime(0, targetTime);
  }
  cutGroups.set(key, [voice]);
}

function playSynth(
  context: AnyContext,
  mixGraph: MixGraph,
  soundName: string,
  event: PlaybackEvent,
  targetTime: number,
  cps: number,
): LoadedVoice {
  const env = createEnvelope(context, event, targetTime, cps, DEFAULT_SYNTH_ENVELOPE);
  const stopTime =
    targetTime +
    Math.max(event.duration / cps, MIN_NOTE_DURATION_SECONDS) +
    env.release +
    STOP_TIME_PADDING_SECONDS;
  const destination = connectOutputChain(
    context,
    env,
    event.payload,
    cps,
    resolveOrbitDestination(context, mixGraph, event.payload.orbit),
    { startTime: targetTime, stopTime },
  );
  const outputGain = new GainNode(context, { gain: DEFAULT_SYNTH_OUTPUT_GAIN });
  outputGain.connect(destination);
  if (soundName === 'noise') {
    const buffer = createNoiseBuffer(context);
    const source = new BufferSourceNode(context, { buffer, loop: true });
    source.connect(outputGain);
    source.start(targetTime);
    source.stop(stopTime);
    return { gate: env, sources: [source] };
  }

  const frequency = resolveFrequency(event.payload);
  const oscillator = new OscillatorNode(context, {
    frequency,
    type: soundName === 'saw' ? 'sawtooth' : (soundName as OscillatorType),
  });
  const sources: Array<AudioBufferSourceNode | OscillatorNode> = [oscillator];
  const fmAmount = coerceFiniteNumber(event.payload.fm);
  if (fmAmount !== undefined && fmAmount > 0) {
    const depth = clamp(fmAmount, 0.05, 8);
    const modulator = new OscillatorNode(context, {
      frequency: frequency * DEFAULT_FM_RATIO,
      type: 'sine',
    });
    const modGain = new GainNode(context, {
      gain: frequency * depth * DEFAULT_FM_DEPTH,
    });
    modulator.connect(modGain);
    modGain.connect(oscillator.frequency);
    modulator.start(targetTime);
    modulator.stop(stopTime);
    sources.push(modulator);
  }
  oscillator.connect(outputGain);
  oscillator.start(targetTime);
  oscillator.stop(stopTime);
  return { gate: env, sources };
}

function playCsound(
  context: AnyContext,
  mixGraph: MixGraph,
  event: PlaybackEvent,
  targetTime: number,
  cps: number,
): LoadedVoice | undefined {
  const spec = resolveCsoundVoiceSpec(event, cps);
  if (!spec) {
    return undefined;
  }

  if (!spec.knownInstrument && !warnedUnknownCsoundInstruments.has(spec.instrument)) {
    warnedUnknownCsoundInstruments.add(spec.instrument);
    console.warn(pc.yellow(`unknown csound instrument: ${spec.instrument}`));
  }

  const envelopeDefaults = resolveCsoundEnvelope(spec.preset);
  const env = createEnvelope(context, event, targetTime, cps, envelopeDefaults);
  const stopTime = targetTime + spec.duration + env.release + STOP_TIME_PADDING_SECONDS;
  const destination = connectOutputChain(
    context,
    env,
    event.payload,
    cps,
    resolveOrbitDestination(context, mixGraph, event.payload.orbit),
    { startTime: targetTime, stopTime },
  );
  const outputGain = new GainNode(context, {
    gain:
      DEFAULT_CSOUND_OUTPUT_GAIN *
      (spec.mode === 'midi' ? clamp(spec.velocity / MIDI_MAX_VALUE, 0.1, 1.25) : 1),
  });
  outputGain.connect(destination);

  switch (spec.preset) {
    case 'fm':
      return playCsoundFm(context, outputGain, spec, targetTime, stopTime, env);
    case 'noise':
      return playCsoundNoise(context, outputGain, spec, targetTime, stopTime, env, 7_000);
    case 'drum':
      return playCsoundDrum(context, outputGain, spec, targetTime, stopTime, env);
    case 'organ':
      return playCsoundOrgan(context, outputGain, spec, targetTime, stopTime, env);
    case 'pad':
      return playCsoundPad(context, outputGain, spec, targetTime, stopTime, env);
    case 'pluck':
      return playCsoundPluck(context, outputGain, spec, targetTime, stopTime, env);
    default:
      return playCsoundAnalog(context, outputGain, spec, targetTime, stopTime, env);
  }
}

function connectOutputChain(
  context: AnyContext,
  input: GainNode,
  payload: Record<string, unknown>,
  cps: number,
  destination: AudioNode,
  window?: { startTime: number; stopTime: number },
): AudioNode {
  let current: AudioNode = input;

  const panValue = coerceFiniteNumber(payload.pan);
  if (panValue !== undefined) {
    const panner = new StereoPannerNode(context, { pan: clamp(panValue, -1, 1) });
    current.connect(panner);
    current = panner;
  }

  const lpf = coerceFiniteNumber(payload.lpf ?? payload.cutoff);
  if (lpf !== undefined) {
    const filter = new BiquadFilterNode(context, {
      frequency: clamp(lpf, MIN_AUDIBLE_FREQUENCY_HZ, MAX_AUDIBLE_FREQUENCY_HZ),
      type: 'lowpass',
    });
    const lpq = coerceFiniteNumber(payload.lpq);
    if (lpq !== undefined) {
      filter.Q.value = clamp(lpq, 0.0001, 30);
    }
    current.connect(filter);
    current = filter;
  }

  const hpf = coerceFiniteNumber(payload.hpf ?? payload.hcutoff);
  if (hpf !== undefined) {
    const filter = new BiquadFilterNode(context, {
      frequency: clamp(hpf, MIN_AUDIBLE_FREQUENCY_HZ, MAX_AUDIBLE_FREQUENCY_HZ),
      type: 'highpass',
    });
    current.connect(filter);
    current = filter;
  }

  const shapeAmount = coerceFiniteNumber(payload.shape);
  if (shapeAmount !== undefined && shapeAmount > 0) {
    const shaper = new WaveShaperNode(context);
    shaper.curve = createDistortionCurve(shapeAmount);
    shaper.oversample = '2x';
    current.connect(shaper);
    current = shaper;
  }

  const phaserAmount = coerceFiniteNumber(payload.phaser);
  if (phaserAmount !== undefined && phaserAmount > 0) {
    current = createPhaserChain(context, current, phaserAmount, window);
  }

  const dry = new GainNode(context, { gain: 1 });
  current.connect(dry);
  dry.connect(destination);

  const delaySettings = resolveDelaySettings(payload.delay, cps);
  if (delaySettings) {
    const delay = new DelayNode(context, {
      delayTime: delaySettings.time,
      maxDelayTime: DEFAULT_DELAY_MAX_SECONDS,
    });
    const feedback = new GainNode(context, { gain: delaySettings.feedback });
    const wet = new GainNode(context, { gain: delaySettings.mix });
    current.connect(delay);
    delay.connect(wet);
    wet.connect(destination);
    delay.connect(feedback);
    feedback.connect(delay);
  }

  const roomAmount = coerceFiniteNumber(payload.room);
  if (roomAmount !== undefined && roomAmount > 0) {
    const roomSize = clampNumber(payload.size, 0.05, 8, DEFAULT_ROOM_SIZE);
    const convolver = new ConvolverNode(context);
    convolver.buffer = getImpulseResponse(context, roomSize);
    const wet = new GainNode(context, { gain: clamp(roomAmount, 0, 2) });
    current.connect(convolver);
    convolver.connect(wet);
    wet.connect(destination);
  }

  return input;
}

function createMixGraph(context: AnyContext, scene: SceneSpec, cps: number): MixGraph {
  const masterInput = new GainNode(context, { gain: 1 });
  const masterGain = new GainNode(context, { gain: clampNumber(scene.master?.gain, 0, 2, 1) });
  masterInput.connect(masterGain);
  connectOutputChain(
    context,
    masterGain,
    (scene.master ?? {}) as Record<string, unknown>,
    cps,
    context.destination,
  );
  return { masterInput, orbitInputs: new Map<string, GainNode>() };
}

function resolveOrbitDestination(context: AnyContext, mixGraph: MixGraph, orbit: unknown): GainNode {
  if (typeof orbit !== 'string' || orbit.trim() === '') {
    return mixGraph.masterInput;
  }
  const key = orbit.trim();
  const existing = mixGraph.orbitInputs.get(key);
  if (existing) {
    return existing;
  }
  const bus = new GainNode(context, { gain: 1 });
  bus.connect(mixGraph.masterInput);
  mixGraph.orbitInputs.set(key, bus);
  return bus;
}

function createEnvelope(
  context: AnyContext,
  event: PlaybackEvent,
  targetTime: number,
  cps: number,
  defaults: EnvelopeDefaults,
): GainNode & { release: number } {
  const gain = new GainNode(context, { gain: 0 });
  const attack = clampNumber(event.payload.attack, 0.001, 2, defaults.attack);
  const decay = clampNumber(event.payload.decay, 0.001, 4, defaults.decay);
  const release = clampNumber(event.payload.release, 0.001, 4, defaults.release);
  const sustain = clampNumber(event.payload.sustain, 0, 1, defaults.sustain);
  const peak = clampNumber(event.payload.gain, 0, 2, defaults.peak);
  const duration = Math.max(event.duration / cps, MIN_NOTE_DURATION_SECONDS);
  const attackEnd = targetTime + attack;
  const holdEnd = targetTime + duration;
  const decayEnd = Math.min(attackEnd + decay, holdEnd);

  gain.gain.setValueAtTime(0, targetTime);
  gain.gain.linearRampToValueAtTime(peak, attackEnd);
  gain.gain.linearRampToValueAtTime(peak * sustain, decayEnd);
  gain.gain.setValueAtTime(peak * sustain, holdEnd);
  gain.gain.linearRampToValueAtTime(ENVELOPE_RELEASE_FLOOR, holdEnd + release);
  return Object.assign(gain, { release });
}

function resolveFrequency(payload: Record<string, unknown>): number {
  const frequency = coerceFiniteNumber(payload.freq);
  if (frequency !== undefined && frequency > 0) {
    return frequency;
  }

  // If payload.xen is set, parse it as xenharmonic notation and apply as a
  // frequency ratio relative to the base frequency (default C4 = 261.63 Hz).
  const xenValue = payload.xen;
  if (typeof xenValue === 'string') {
    const ratio = parseXenValue(xenValue);
    if (ratio !== undefined && ratio > 0) {
      const baseFreq = coerceFiniteNumber(payload.baseFreq) ?? 261.63;
      return baseFreq * ratio;
    }
  }

  const note = payload.note ?? payload.n;

  // EDO tuning: when payload.edo is a positive number, use N-EDO frequency
  // calculation instead of standard 12-TET.
  const edoDivisions = coerceFiniteNumber(payload.edo);
  if (edoDivisions !== undefined && edoDivisions > 0) {
    const step = typeof note === 'number' ? note : typeof note === 'string' ? Number(note) : NaN;
    if (Number.isFinite(step)) {
      const baseFreq = coerceFiniteNumber(payload.baseFreq) ?? undefined;
      return edoFrequency(step, edoDivisions, baseFreq);
    }
  }

  if (typeof note === 'number') {
    return midiToFrequency(60 + note);
  }

  if (typeof note === 'string') {
    const named = parseNamedPitch(note);
    if (named) {
      return named;
    }
    const numeric = Number(note);
    if (Number.isFinite(numeric)) {
      return midiToFrequency(60 + numeric);
    }
  }

  return 220;
}

function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(Math.max(frequency, 1e-6) / 440);
}

function parseNamedPitch(value: string): number | undefined {
  const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const [, noteName, accidental, octaveRaw] = match;
  if (!noteName || !octaveRaw) {
    return undefined;
  }
  const octave = Number(octaveRaw);
  const scale = { A: 9, B: 11, C: 0, D: 2, E: 4, F: 5, G: 7 } as const;
  let semitone = scale[noteName.toUpperCase() as keyof typeof scale];
  if (accidental === '#') {
    semitone += 1;
  } else if (accidental === 'b') {
    semitone -= 1;
  }
  return midiToFrequency((octave + 1) * 12 + semitone);
}

function createNoiseBuffer(context: AnyContext): AudioBuffer {
  const length = Math.max(1, Math.ceil(context.sampleRate * NOISE_BUFFER_SECONDS));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
    const channel = new Float32Array(length);
    let seed = (0x1f123bb5 + channelIndex * 0x9e3779b9) >>> 0;
    for (let index = 0; index < length; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      channel[index] = (seed / 0xffffffff) * 2 - 1;
    }
    buffer.copyToChannel(channel, channelIndex);
  }
  return buffer;
}

function resolveCsoundPreset(instrument: string, body?: string): CsoundPreset {
  const fingerprint = `${instrument} ${body ?? ''}`.toLowerCase();
  if (/fm|modulator|carrier/.test(fingerprint)) {
    return 'fm';
  }
  if (/organ|vox|humana|additive|drawbar|buzz/.test(fingerprint)) {
    return 'organ';
  }
  if (/pluck|plk|harp|karplus|waveguide/.test(fingerprint)) {
    return 'pluck';
  }
  if (/pad|swell|bow/.test(fingerprint)) {
    return 'pad';
  }
  if (/bd|sd|snare|tom|conga|cowbell|clap|rimshot|claves|cymbal|maraca|drum/.test(fingerprint)) {
    return 'drum';
  }
  if (/noi|noise|hh|hat|click|rim/.test(fingerprint)) {
    return 'noise';
  }
  return 'analog';
}

function resolveCsoundEnvelope(preset: CsoundPreset): EnvelopeDefaults {
  switch (preset) {
    case 'pad':
      return { attack: 0.02, decay: 0.2, peak: 0.8, release: 0.12, sustain: 0.75 };
    case 'pluck':
    case 'drum':
      return { attack: 0.001, decay: 0.04, peak: 0.9, release: 0.04, sustain: 0.15 };
    case 'noise':
      return { attack: 0.001, decay: 0.03, peak: 0.85, release: 0.02, sustain: 0.1 };
    case 'organ':
      return { attack: 0.005, decay: 0.08, peak: 0.75, release: 0.08, sustain: 0.8 };
    default:
      return { attack: 0.002, decay: 0.06, peak: 0.8, release: 0.05, sustain: 0.55 };
  }
}

function playCsoundAnalog(
  context: AnyContext,
  destination: GainNode,
  spec: CsoundVoiceSpec,
  targetTime: number,
  stopTime: number,
  env: GainNode,
): LoadedVoice {
  const filter = new BiquadFilterNode(context, {
    frequency: clamp(spec.frequency * 3.5, 120, 8_000),
    Q: 0.8,
    type: 'lowpass',
  });
  filter.connect(destination);

  const detunes = [-5, 0, 5];
  const sources = detunes.map((detune) => {
    const oscillator = new OscillatorNode(context, {
      detune,
      frequency: spec.frequency,
      type: detune === 0 ? 'sawtooth' : 'triangle',
    });
    const gain = new GainNode(context, { gain: detune === 0 ? 0.65 : 0.22 });
    oscillator.connect(gain);
    gain.connect(filter);
    oscillator.start(targetTime);
    oscillator.stop(stopTime);
    return oscillator;
  });

  return { gate: env, sources };
}

function playCsoundFm(
  context: AnyContext,
  destination: GainNode,
  spec: CsoundVoiceSpec,
  targetTime: number,
  stopTime: number,
  env: GainNode,
): LoadedVoice {
  const carrier = new OscillatorNode(context, {
    frequency: spec.frequency,
    type: 'sine',
  });
  const modulator = new OscillatorNode(context, {
    frequency: spec.frequency * 3,
    type: 'sine',
  });
  const modGain = new GainNode(context, {
    gain: spec.frequency * 1.4,
  });
  const output = new GainNode(context, { gain: 0.85 });
  modulator.connect(modGain);
  modGain.connect(carrier.frequency);
  carrier.connect(output);
  output.connect(destination);
  modulator.start(targetTime);
  carrier.start(targetTime);
  modulator.stop(stopTime);
  carrier.stop(stopTime);
  return { gate: env, sources: [carrier, modulator] };
}

function playCsoundNoise(
  context: AnyContext,
  destination: GainNode,
  spec: CsoundVoiceSpec,
  targetTime: number,
  stopTime: number,
  env: GainNode,
  centerFrequency: number,
): LoadedVoice {
  const filter = new BiquadFilterNode(context, {
    Q: 3,
    frequency: clamp(centerFrequency + spec.frequency * 0.5, 600, 12_000),
    type: 'bandpass',
  });
  const source = new BufferSourceNode(context, { buffer: createNoiseBuffer(context), loop: true });
  source.connect(filter);
  filter.connect(destination);
  source.start(targetTime);
  source.stop(stopTime);
  return { gate: env, sources: [source] };
}

function playCsoundDrum(
  context: AnyContext,
  destination: GainNode,
  spec: CsoundVoiceSpec,
  targetTime: number,
  stopTime: number,
  env: GainNode,
): LoadedVoice {
  const tone = new OscillatorNode(context, {
    frequency: clamp(spec.frequency * 0.5, 45, 220),
    type: 'sine',
  });
  const toneGain = new GainNode(context, { gain: 0.9 });
  tone.frequency.setValueAtTime(clamp(spec.frequency * 0.75, 60, 240), targetTime);
  tone.frequency.exponentialRampToValueAtTime(clamp(spec.frequency * 0.18, 30, 90), targetTime + 0.08);
  tone.connect(toneGain);
  toneGain.connect(destination);

  const noise = new BufferSourceNode(context, { buffer: createNoiseBuffer(context), loop: true });
  const noiseFilter = new BiquadFilterNode(context, {
    frequency: 1_800,
    Q: 1.5,
    type: 'highpass',
  });
  const noiseGain = new GainNode(context, { gain: 0.18 });
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(destination);

  tone.start(targetTime);
  tone.stop(stopTime);
  noise.start(targetTime);
  noise.stop(Math.min(stopTime, targetTime + 0.06));
  return { gate: env, sources: [tone, noise] };
}

function playCsoundOrgan(
  context: AnyContext,
  destination: GainNode,
  spec: CsoundVoiceSpec,
  targetTime: number,
  stopTime: number,
  env: GainNode,
): LoadedVoice {
  const harmonics = [1, 2, 3, 4];
  const gains = [0.45, 0.2, 0.12, 0.08];
  const sources = harmonics.map((harmonic, index) => {
    const oscillator = new OscillatorNode(context, {
      frequency: spec.frequency * harmonic,
      type: harmonic % 2 === 0 ? 'triangle' : 'sine',
    });
    const gain = new GainNode(context, { gain: gains[index] ?? 0.05 });
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(targetTime);
    oscillator.stop(stopTime);
    return oscillator;
  });
  return { gate: env, sources };
}

function playCsoundPad(
  context: AnyContext,
  destination: GainNode,
  spec: CsoundVoiceSpec,
  targetTime: number,
  stopTime: number,
  env: GainNode,
): LoadedVoice {
  const filter = new BiquadFilterNode(context, {
    frequency: clamp(spec.frequency * 2.2, 200, 5_000),
    Q: 0.6,
    type: 'lowpass',
  });
  filter.connect(destination);

  const sources = [-8, 0, 8].map((detune) => {
    const oscillator = new OscillatorNode(context, {
      detune,
      frequency: spec.frequency,
      type: detune === 0 ? 'triangle' : 'sawtooth',
    });
    const gain = new GainNode(context, { gain: detune === 0 ? 0.4 : 0.16 });
    oscillator.connect(gain);
    gain.connect(filter);
    oscillator.start(targetTime);
    oscillator.stop(stopTime);
    return oscillator;
  });
  return { gate: env, sources };
}

function playCsoundPluck(
  context: AnyContext,
  destination: GainNode,
  spec: CsoundVoiceSpec,
  targetTime: number,
  stopTime: number,
  env: GainNode,
): LoadedVoice {
  const oscillator = new OscillatorNode(context, {
    frequency: spec.frequency,
    type: 'triangle',
  });
  const filter = new BiquadFilterNode(context, {
    frequency: clamp(spec.frequency * 4, 500, 9_000),
    Q: 3.5,
    type: 'lowpass',
  });
  const transient = new BufferSourceNode(context, { buffer: createNoiseBuffer(context), loop: true });
  const transientFilter = new BiquadFilterNode(context, {
    frequency: clamp(spec.frequency * 3, 400, 8_000),
    Q: 2.5,
    type: 'bandpass',
  });
  const transientGain = new GainNode(context, { gain: 0.08 });

  oscillator.connect(filter);
  filter.connect(destination);
  transient.connect(transientFilter);
  transientFilter.connect(transientGain);
  transientGain.connect(destination);

  oscillator.start(targetTime);
  oscillator.stop(stopTime);
  transient.start(targetTime);
  transient.stop(Math.min(stopTime, targetTime + 0.03));
  return { gate: env, sources: [oscillator, transient] };
}

function clamp(value: number, min: number, max = Number.POSITIVE_INFINITY): number {
  return Math.min(max, Math.max(min, value));
}

function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const numeric = Number(value.trim());
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return undefined;
}

function resolveDelaySettings(
  value: unknown,
  cps: number,
): { feedback: number; mix: number; time: number } | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return {
      feedback: DEFAULT_DELAY_FEEDBACK,
      mix: clamp(value, 0, 2),
      time: clamp(
        DEFAULT_DELAY_CYCLES / Math.max(cps, MIN_CPS_DIVISOR),
        MIN_DELAY_TIME_SECONDS,
        DEFAULT_DELAY_MAX_SECONDS,
      ),
    };
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const parts = value
    .split(':')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
  if (parts.length === 0) {
    return undefined;
  }
  return {
    feedback: clamp(parts[2] ?? DEFAULT_DELAY_FEEDBACK, 0, MAX_DELAY_FEEDBACK),
    mix: clamp(parts[0] ?? 0, 0, 2),
    time: clamp(
      (parts[1] ?? DEFAULT_DELAY_CYCLES) / Math.max(cps, MIN_CPS_DIVISOR),
      MIN_DELAY_TIME_SECONDS,
      DEFAULT_DELAY_MAX_SECONDS,
    ),
  };
}

function createDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 1024;
  const curve = new Float32Array(new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT));
  const drive = clamp(amount, 0.01, 4) * 25;
  for (let index = 0; index < samples; index += 1) {
    const x = (index / (samples - 1)) * 2 - 1;
    curve[index] = ((3 + drive) * x * 20 * (Math.PI / 180)) / (Math.PI + drive * Math.abs(x));
  }
  return curve;
}

function createPhaserChain(
  context: AnyContext,
  input: AudioNode,
  amount: number,
  window?: { startTime: number; stopTime: number },
): AudioNode {
  const depth = clamp(amount, 0.05, 4);
  const stages = Array.from({ length: 4 }, (_, index) => {
    const filter = new BiquadFilterNode(context, {
      frequency: 300 + depth * 120 + index * 180,
      type: 'allpass',
    });
    return filter;
  });

  let current: AudioNode = input;
  for (const stage of stages) {
    current.connect(stage);
    current = stage;
  }

  const feedback = new GainNode(context, {
    gain: clamp(DEFAULT_PHASER_FEEDBACK + depth * 0.08, 0, 0.85),
  });
  current.connect(feedback);
  feedback.connect(stages[0] as AudioNode);

  const lfo = new OscillatorNode(context, {
    frequency: DEFAULT_PHASER_RATE + depth * 0.07,
    type: 'sine',
  });
  for (const [index, stage] of stages.entries()) {
    const modulation = new GainNode(context, {
      gain: 180 + depth * (220 + index * 45),
    });
    lfo.connect(modulation);
    modulation.connect(stage.frequency);
  }

  if (window) {
    lfo.start(window.startTime);
    lfo.stop(window.stopTime);
  } else {
    lfo.start(0);
  }

  return current;
}

function getImpulseResponse(context: AnyContext, size: number): AudioBuffer {
  const key = `${context.sampleRate}:${size.toFixed(3)}`;
  const cached = impulseResponseCache.get(context)?.get(key);
  if (cached) {
    return cached;
  }
  const buffer = createImpulseResponse(context, size);
  const contextCache = impulseResponseCache.get(context) ?? new Map<string, AudioBuffer>();
  contextCache.set(key, buffer);
  impulseResponseCache.set(context, contextCache);
  return buffer;
}

function getReversedBuffer(context: AnyContext, buffer: AudioBuffer): AudioBuffer {
  const cached = reversedBufferCache.get(buffer);
  if (cached) {
    return cached;
  }
  const reversed = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const source = buffer.getChannelData(channelIndex);
    const channel = new Float32Array(buffer.length);
    for (let index = 0; index < buffer.length; index += 1) {
      channel[index] = source[buffer.length - 1 - index] ?? 0;
    }
    reversed.copyToChannel(channel, channelIndex);
  }
  reversedBufferCache.set(buffer, reversed);
  return reversed;
}

function createImpulseResponse(context: AnyContext, size: number): AudioBuffer {
  const duration = clamp(size, 0.05, 8);
  const length = Math.max(1, Math.ceil(context.sampleRate * duration));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  const decay = Math.max(0.25, duration * 1.2);
  for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
    const channel = new Float32Array(length);
    let seed = (0x811c9dc5 ^ (channelIndex + 1) ^ Math.round(duration * 10_000)) >>> 0;
    for (let index = 0; index < length; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = (seed / 0xffffffff) * 2 - 1;
      const position = index / Math.max(1, length - 1);
      channel[index] = noise * Math.exp((-decay * index) / length) * (1 - position ** 1.5);
    }
    buffer.copyToChannel(channel, channelIndex);
  }
  return buffer;
}

function isLoopEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'off';
  }
  return false;
}

class SampleRegistry {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly manifests = new Map<string, SampleManifestCacheEntry>();

  async prepareScene(scene: SceneSpec, cacheDir: string): Promise<void> {
    await mkdir(cacheDir, { recursive: true });
    for (const source of scene.samples) {
      if (!this.manifests.has(source.ref)) {
        this.manifests.set(source.ref, await resolveManifest(source.ref, cacheDir));
      }
    }
  }

  async getSample(
    context: AnyContext,
    soundName: string,
    bank: unknown,
    variant: unknown,
  ): Promise<AudioBuffer | undefined> {
    const keyCandidates = buildSampleKeys(soundName, bank);
    for (const manifest of this.manifests.values()) {
      for (const key of keyCandidates) {
        const asset = resolveManifestAsset(manifest, key);
        if (!asset) {
          continue;
        }

        const index = typeof variant === 'number' ? Math.max(0, Math.floor(variant)) : 0;
        const resolvedIndex = Math.min(index, asset.files.length - 1);
        const selectedFile = asset.files[resolvedIndex];
        if (!selectedFile) {
          continue;
        }
        const filePath = path.resolve(asset.basePath, selectedFile);
        const cacheKey = `${manifest.rootDir}:${key}:${resolvedIndex}`;
        if (!this.buffers.has(cacheKey)) {
          const bytes = await readFile(filePath);
          const decoded = await context.decodeAudioData(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          );
          this.buffers.set(cacheKey, decoded);
        }
        return this.buffers.get(cacheKey);
      }
    }

    return undefined;
  }
}

function buildSampleKeys(soundName: string, bank: unknown): string[] {
  const keys = [soundName];
  if (typeof bank === 'string') {
    keys.unshift(`${bank}_${soundName}`);
  }
  return keys;
}

function resolveManifestAsset(manifestEntry: SampleManifestCacheEntry, key: string): SampleAsset | undefined {
  const raw = manifestEntry.manifest[key];
  if (!raw) {
    return undefined;
  }
  return {
    basePath: path.resolve(manifestEntry.rootDir, manifestEntry.manifest._base ?? '.'),
    files: Array.isArray(raw) ? raw : [raw],
  };
}

async function resolveManifest(ref: string, cacheDir: string): Promise<SampleManifestCacheEntry> {
  if (ref.startsWith('github:')) {
    return resolveGithubManifest(ref, cacheDir);
  }

  const fullPath = path.resolve(ref);
  const stats = await stat(fullPath);
  const manifestPath = stats.isDirectory() ? path.join(fullPath, 'strudel.json') : fullPath;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as SampleManifest;
  return { manifest, rootDir: path.dirname(manifestPath) };
}

async function resolveGithubManifest(ref: string, cacheDir: string): Promise<SampleManifestCacheEntry> {
  const [, rest] = ref.split(':');
  if (!rest) {
    throw new Error(`Invalid github sample ref: ${ref}`);
  }
  const [owner, repo = 'samples', branch = 'main'] = rest.split('/');
  if (!owner) {
    throw new Error(`Invalid github sample ref: ${ref}`);
  }
  const rootDir = path.join(cacheDir, 'github', owner, repo, branch);
  const manifestPath = path.join(rootDir, 'strudel.json');
  await mkdir(rootDir, { recursive: true });

  if (!(await exists(manifestPath))) {
    const manifestUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/strudel.json`;
    const response = await fetch(manifestUrl);
    if (!response.ok) {
      throw new Error(`Unable to fetch sample manifest: ${manifestUrl}`);
    }
    await writeFile(manifestPath, await response.text());
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as SampleManifest;
  const normalizedManifest = await cacheGithubManifestAssets(manifest, {
    branch,
    owner,
    repo,
    rootDir,
  });
  await writeFile(manifestPath, JSON.stringify(normalizedManifest, null, 2));

  return { manifest: normalizedManifest, rootDir };
}

function normalizeAssetPath(base: string, file: string): string {
  return path.posix.join(base.replaceAll('\\', '/'), file.replaceAll('\\', '/'));
}

async function cacheGithubManifestAssets(
  manifest: SampleManifest,
  options: {
    branch: string;
    owner: string;
    repo: string;
    rootDir: string;
  },
): Promise<SampleManifest> {
  const base = manifest._base ?? '.';
  const normalized: SampleManifest = { _base: '.' };

  for (const [key, value] of Object.entries(manifest)) {
    if (key === '_base' || !value) {
      continue;
    }

    const files = Array.isArray(value) ? value : [value];
    const localFiles = await Promise.all(
      files.map((file) =>
        cacheGithubAsset(file, {
          base,
          branch: options.branch,
          owner: options.owner,
          repo: options.repo,
          rootDir: options.rootDir,
        }),
      ),
    );

    normalized[key] = Array.isArray(value) ? localFiles : localFiles[0];
  }

  return normalized;
}

async function cacheGithubAsset(
  file: string,
  options: {
    base: string;
    branch: string;
    owner: string;
    repo: string;
    rootDir: string;
  },
): Promise<string> {
  const localRelativePath = deriveLocalAssetPath(file, options.base);
  const localFile = path.resolve(options.rootDir, localRelativePath);
  if (!(await exists(localFile))) {
    await mkdir(path.dirname(localFile), { recursive: true });
    const assetUrl = resolveGithubAssetUrl(file, options.base, options.owner, options.repo, options.branch);
    const response = await fetch(assetUrl);
    if (!response.ok) {
      throw new Error(`Unable to fetch sample asset: ${assetUrl}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(localFile, buffer);
  }
  return localRelativePath;
}

function deriveLocalAssetPath(file: string, base: string): string {
  if (isRemoteUrl(file)) {
    const url = new URL(file);
    return path.posix.join('__remote__', url.hostname, url.pathname.replace(/^\/+/, ''));
  }

  if (isRemoteUrl(base)) {
    return file.replaceAll('\\', '/');
  }

  return normalizeAssetPath(base, file);
}

function resolveGithubAssetUrl(
  file: string,
  base: string,
  owner: string,
  repo: string,
  branch: string,
): string {
  if (isRemoteUrl(file)) {
    return file;
  }

  if (isRemoteUrl(base)) {
    return new URL(file.replaceAll('\\', '/'), ensureTrailingSlash(base)).toString();
  }

  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${normalizeAssetPath(base, file)}`;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

async function exists(value: string): Promise<boolean> {
  try {
    await stat(value);
    return true;
  } catch {
    return false;
  }
}

function audioBufferToWav(buffer: AudioBuffer): Buffer {
  const channels = buffer.numberOfChannels;
  const length = buffer.length * channels * 2 + 44;
  const result = Buffer.alloc(length);
  const view = new DataView(result.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, length - 8, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, length - 44, true);

  const channelData = Array.from({ length: channels }, (_, channel) => {
    const data = new Float32Array(buffer.length);
    buffer.copyFromChannel(data, channel);
    return data;
  });

  let offset = 44;
  for (let index = 0; index < buffer.length; index += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel]?.[index] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return result;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function resolveCacheDir(fromUrl: string | URL): string {
  return path.resolve(path.dirname(fileURLToPath(fromUrl)), '..', '..', '..', '.tussel-cache', 'samples');
}

export { MidiOutputManager, loadMidiOutputFactory } from './midi-output.js';
export type { MidiOutputFactory, MidiOutputPort, MidiPortInfo } from './midi-output.js';
export { OscOutputManager } from './osc-output.js';
export type { OscArgument } from './osc-output.js';
