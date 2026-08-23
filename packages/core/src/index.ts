import { Chord, Interval, Note, Scale } from '@tonaljs/tonal';
import {
  type ChannelSpec,
  coerceFiniteNumber,
  createLogger,
  type ExpressionNode,
  type ExpressionValue,
  getInputValue,
  isExpressionNode,
  isPlainObject,
  PROPERTY_METHOD_NAMES,
  resolveGamepadInputKey,
  resolveInputKey,
  resolveMidiInputKey,
  resolveMotionInputKey,
  type SceneSpec,
  TusselCoreError,
} from '@tussel/ir';
import { inferMiniSteps, queryMini, queryMondo } from '@tussel/mini';
import {
  coerceMiniValue,
  evaluateMiniNumber,
  evaluateNumericValue,
  evaluatePatternValue,
  extractEventValue,
  firstPayloadEntry,
  isTruthyMaskValue,
  queryValueEvents,
  resolvePropertyValue,
} from './evaluate.js';
import { applyRootNotes, applyScale, applyScaleTranspose, applyTranspose, applyVoicing } from './pitch.js';
import {
  clampSignalResult,
  coerceSignalNumber,
  evaluateSignalExpression,
  evaluateSignalValue,
  resolveSignalFallback,
} from './signals.js';
import {
  alignIn,
  alignMix,
  alignOut,
  alignReset,
  alignSqueeze,
  applyAlignedOperation,
  applyEuclideanMask,
  applyEuclidLegato,
  applyEuclidRot,
  applyFmap,
  clipEvent,
  mapNumericPayload,
  queryRepeatedCycleWindow,
  remapCycleWindows,
  shiftEvents,
  transformCompress,
  transformFast,
  transformFastGap,
  transformInside,
  transformIter,
  transformLinger,
  transformOutside,
  transformPalindrome,
  transformRev,
  transformRibbon,
  transformSlow,
  transformSlowGap,
  transformSwingBy,
  transformZoom,
} from './time-transforms.js';

export { evaluateNumericValue };

import type { ExternalDispatchEvent, PlaybackEvent, QueryContext } from './types.js';
import {
  clampNumber,
  hashEvent,
  hashString,
  leastCommonMultiple,
  normalizeCyclePhase,
  normalizeWeightedEntry,
  positiveMod,
  seededRandom,
  shuffledIndices,
  smoothNoise,
} from './utils.js';

export { createLogger } from '@tussel/ir';
export { Scheduler } from './scheduler.js';
export type {
  ExternalDispatchEvent,
  MidiCcDispatchEvent,
  MidiCommandDispatchEvent,
  MidiNoteDispatchEvent,
  MidiPitchBendDispatchEvent,
  MidiTouchDispatchEvent,
  OscDispatchEvent,
  PlaybackEvent,
  QueryContext,
  SchedulerOptions,
} from './types.js';
export {
  clampNumber,
  gcdIntegers,
  hashEvent,
  hashString,
  lcmIntegers,
  leastCommonMultiple,
  normalizeCyclePhase,
  normalizeWeightedEntry,
  positiveMod,
  seededRandom,
  shuffledIndices,
  smoothNoise,
} from './utils.js';
export {
  centsToRatio,
  createEdoScale,
  edoFrequency,
  namedPitchToFrequency,
  parseXenValue,
  ratioToCents,
  resolveEdoFrequency,
  tunedStepFrequency,
} from './xen.js';

export interface InternalQueryContext extends QueryContext {
  channel: string;
}

/**
 * Set of method names treated as simple property annotations on pattern events.
 *
 * When the pattern evaluator encounters a method call whose name is in this set,
 * it bypasses the main switch statement and instead writes the method's argument
 * directly into the event payload (via `annotateEvents`). Methods NOT in this set
 * go through the switch statement for special handling (e.g. `fast`, `rev`, `scale`).
 *
 * Derived from the shared PATTERN_METHOD_REGISTRY in @tussel/ir (kind === 'property').
 */
export const PROPERTY_METHODS: ReadonlySet<string> = PROPERTY_METHOD_NAMES;

const coreLogger = createLogger('tussel/core');

// ---------------------------------------------------------------------------
// Named constants — pattern engine defaults
// ---------------------------------------------------------------------------

/**
 * Default MIDI velocity / CC value when no explicit velocity, gain, or value
 * is provided in the event payload.
 *
 * 102 (out of 0-127) corresponds to ~80 % intensity — a musically sensible
 * "moderately loud" default that avoids both inaudible softness and harsh
 * maximum volume.
 */
const DEFAULT_MIDI_VALUE = 102;

/**
 * Prime multiplier applied to the cycle seed in seeded-random index
 * generation (e.g. `scramble`).
 *
 * Used as `cycleSeed * SEED_PRIME_CYCLE + index * SEED_PRIME_INDEX` to
 * produce varied but deterministic hash inputs. The primes 37 and 17 were
 * chosen empirically for good distribution across typical cycle/index ranges
 * without being so large that floating-point precision is lost.
 */
const SEED_PRIME_CYCLE = 37;

/**
 * Prime multiplier applied to the element index in seeded-random index
 * generation.
 *
 * @see {@link SEED_PRIME_CYCLE} for rationale.
 */
const SEED_PRIME_INDEX = 17;

/**
 * Minimum clip ratio applied by the `clip` property method.
 *
 * Prevents event durations from being shrunk to effectively zero, which could
 * cause silent or glitchy output. 0.05 (5 %) is small enough to allow very
 * short staccato while keeping events audible.
 */
const MIN_CLIP_RATIO = 0.05;

export function resetWarnings(): void {
  coreLogger.resetSuppression();
}

function warnChannelError(channelName: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  coreLogger.warnOnce(`channel:${channelName}`, `channel "${channelName}" evaluation failed: ${message}`, {
    channel: channelName,
    ...(stack ? { stack } : {}),
  });
  // Opt-in strict mode: re-throw so bugs surface immediately instead of silent silence.
  // Enable via TUSSEL_STRICT_CHANNELS=1 during development to catch hidden bugs.
  if (process.env.TUSSEL_STRICT_CHANNELS === '1') {
    throw error;
  }
}

/**
 * Evaluate an expression value to a number at a given cycle position.
 *
 * Handles numbers (pass-through), strings (mini notation parse), signals
 * (continuous evaluation), and pattern expressions (discrete evaluation).
 * Returns undefined if the value cannot be resolved to a number.
 */

function throwUnsupportedPattern(kind: 'call' | 'method', name: string): never {
  throw new TusselCoreError(`unsupported pattern ${kind} "${name}" is not implemented.`, {
    code: 'TUSSEL_UNSUPPORTED_PATTERN',
    details: { kind, name },
  });
}

/**
 * Query a scene for playback events within a cycle-time window.
 *
 * @param scene  - The scene specification containing channels, transport, and samples.
 * @param begin  - Start of the query window in cycle-time (inclusive). Cycle 0 is the
 *                 beginning of playback; cycle 1 is one full cycle later.
 * @param end    - End of the query window in cycle-time (exclusive). Must be >= begin.
 * @param context - Query context providing the current cycles-per-second (cps) rate.
 * @returns Sorted array of PlaybackEvent objects falling within [begin, end).
 *          Events are sorted by begin time, then channel name.
 */
export function queryScene(
  scene: SceneSpec,
  begin: number,
  end: number,
  context: QueryContext,
): PlaybackEvent[] {
  assertQueryWindow(begin, end);
  const events = Object.entries(scene.channels).flatMap(([channelName, channel]) =>
    queryChannel(channelName, channel, begin, end, context),
  );

  return events.sort((left, right) => left.begin - right.begin || left.channel.localeCompare(right.channel));
}

export function collectExternalDispatches(
  event: PlaybackEvent,
  targetTime?: number,
): ExternalDispatchEvent[] {
  if (event.payload.mute) {
    return [];
  }

  const dispatches: ExternalDispatchEvent[] = [];
  const midiPort = resolveDispatchString(event.payload.midiport, 'default');
  const channelNumber = clampDispatchInteger(event.payload.midichan, 1, 16, 1);
  const midiCc = coerceFiniteNumber(event.payload.midicc ?? event.payload.ccn);
  const midiCommand = event.payload.midicmd;
  const midiBend = coerceFiniteNumber(event.payload.midibend);
  const midiTouch = coerceFiniteNumber(event.payload.miditouch);

  if (midiCc !== undefined) {
    dispatches.push({
      begin: event.begin,
      channel: event.channel,
      channelNumber,
      control: clampDispatchInteger(midiCc, 0, 127, 0),
      end: event.end,
      kind: 'midi-cc',
      payload: { ...event.payload },
      port: midiPort,
      targetTime,
      value: clampDispatchInteger(resolveMidiCcValue(event.payload), 0, 127, 0),
    });
  }

  if (midiCommand !== undefined) {
    dispatches.push({
      begin: event.begin,
      channel: event.channel,
      command:
        typeof midiCommand === 'number' ? Math.round(midiCommand) : `${midiCommand}`.trim().toLowerCase(),
      end: event.end,
      kind: 'midi-command',
      payload: { ...event.payload },
      port: midiPort,
      targetTime,
    });
  }

  if (midiBend !== undefined) {
    dispatches.push({
      begin: event.begin,
      channel: event.channel,
      channelNumber,
      end: event.end,
      kind: 'midi-pitch-bend',
      payload: { ...event.payload },
      port: midiPort,
      targetTime,
      value: clampDispatchInteger(midiBend, 0, 16_383, 8_192),
    });
  }

  if (midiTouch !== undefined) {
    dispatches.push({
      begin: event.begin,
      channel: event.channel,
      channelNumber,
      end: event.end,
      kind: 'midi-touch',
      payload: { ...event.payload },
      port: midiPort,
      targetTime,
      value: clampDispatchInteger(midiTouch, 0, 127, 0),
    });
  }

  const midiNote = resolveMidiDispatchNote(event.payload);
  if (midiNote !== undefined && (midiPort !== 'default' || event.payload.midichan !== undefined)) {
    dispatches.push({
      begin: event.begin,
      channel: event.channel,
      channelNumber,
      end: event.end,
      kind: 'midi-note',
      note: clampDispatchInteger(midiNote, 0, 127, 60),
      payload: { ...event.payload },
      port: midiPort,
      targetTime,
      velocity: clampDispatchInteger(resolveMidiVelocity(event.payload), 1, 127, 100),
    });
  }

  const oscPath = resolveOscDispatchPath(event);
  if (oscPath) {
    dispatches.push({
      begin: event.begin,
      channel: event.channel,
      end: event.end,
      host: resolveDispatchString(event.payload.oschost, '127.0.0.1'),
      kind: 'osc',
      path: oscPath,
      payload: { ...event.payload },
      port: clampDispatchInteger(event.payload.oscport, 1, 65_535, 57_120),
      targetTime,
    });
  }

  return dispatches;
}

function queryChannel(
  channelName: string,
  channel: ChannelSpec,
  begin: number,
  end: number,
  context: QueryContext,
): PlaybackEvent[] {
  try {
    const events = queryPattern(channel.node, begin, end, { ...context, channel: channelName });
    return events.map((event) => {
      const gain = evaluateNumericValue(channel.gain, event.begin);
      const payload = { ...event.payload };
      if (gain !== undefined) {
        payload.gain = gain;
      }
      if (channel.orbit) {
        payload.orbit = channel.orbit;
      }
      if (channel.mute) {
        payload.mute = true;
      }
      return { ...event, payload };
    });
  } catch (error) {
    warnChannelError(channelName, error);
    return [];
  }
}

function assertQueryWindow(begin: number, end: number): void {
  if (!Number.isFinite(begin) || !Number.isFinite(end)) {
    throw new RangeError('queryScene() requires finite begin/end values.');
  }
  if (end < begin) {
    throw new RangeError(`queryScene() requires end >= begin, received begin=${begin} end=${end}.`);
  }
}

function resolveDispatchString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function clampDispatchInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = coerceFiniteNumber(value);
  if (numeric === undefined) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function resolveMidiCcValue(payload: Record<string, unknown>): number {
  return (
    coerceFiniteNumber(payload.ccv) ??
    coerceFiniteNumber(payload.midivalue) ??
    coerceFiniteNumber(payload.value) ??
    normalizeMidiScalar(coerceFiniteNumber(payload.velocity)) ??
    normalizeMidiScalar(coerceFiniteNumber(payload.gain)) ??
    DEFAULT_MIDI_VALUE
  );
}

function resolveMidiVelocity(payload: Record<string, unknown>): number {
  return (
    normalizeMidiScalar(coerceFiniteNumber(payload.velocity) ?? coerceFiniteNumber(payload.gain)) ??
    DEFAULT_MIDI_VALUE
  );
}

function normalizeMidiScalar(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value >= 0 && value <= 1 ? value * 127 : value;
}

function resolveMidiDispatchNote(payload: Record<string, unknown>): number | undefined {
  const frequency = coerceFiniteNumber(payload.freq);
  if (frequency !== undefined && frequency > 0) {
    return 69 + 12 * Math.log2(frequency / 440);
  }

  const numericNote = coerceFiniteNumber(payload.note ?? payload.n);
  if (numericNote !== undefined) {
    return 60 + numericNote;
  }

  const noteName = payload.note ?? payload.n;
  if (typeof noteName === 'string' && noteName.trim() !== '') {
    const midi = Note.midi(noteName.trim());
    if (midi !== null) {
      return midi;
    }
  }

  return undefined;
}

function resolveOscDispatchPath(event: PlaybackEvent): string | undefined {
  const osc = event.payload.osc;
  if (typeof osc === 'string' && osc.trim() !== '') {
    return osc.startsWith('/') ? osc : `/${osc}`;
  }
  if (event.payload.oschost !== undefined || event.payload.oscport !== undefined) {
    return `/${event.channel}`;
  }
  return undefined;
}

export function queryPattern(
  value: ExpressionValue,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  if (!isExpressionNode(value)) {
    if (typeof value === 'string') {
      return literalEvents('value', value, begin, end, context.channel);
    }
    return [];
  }

  if (value.kind === 'call') {
    switch (value.name) {
      case 'stack':
        return value.args.flatMap((entry) => queryPattern(entry, begin, end, context));
      case 'silence':
        return [];
      case 'cat':
        return queryCat(value.args, begin, end, context.channel, context.cps);
      case 'stepcat':
        return queryStepcat(value.args, begin, end, context);
      case 'stepalt':
        return queryStepalt(value.args, begin, end, context);
      case 'zip':
        return queryZip(value.args, begin, end, context);
      case 'choose':
      case 'wchoose':
        return queryChoose(value.args, begin, end, context);
      case 'polymeter':
        return queryPolymeter(value.args, begin, end, context);
      case 'polyrhythm':
        return value.args.flatMap((entry) => queryPattern(entry, begin, end, context));
      case 'seq':
      case 'sequence':
        return querySequence(value.args, begin, end, context.channel, context.cps);
      case 's':
      case 'sound':
      case 'n':
      case 'note':
      case 'i':
      case 'chord':
      case 'value':
        return callPattern(value.name, value.args[0], begin, end, context);
      case 'mondo': {
        const mondoSource = typeof value.args[0] === 'string' ? value.args[0] : '';
        const mondoEvents = queryMondo(mondoSource, begin, end);
        return mondoEvents.map((event) => ({
          begin: event.begin,
          channel: context.channel,
          duration: event.end - event.begin,
          end: event.end,
          payload: { s: event.value },
        }));
      }
      default:
        throwUnsupportedPattern('call', value.name);
    }
  }

  // Lazy target evaluation: many transforms (fast, slow, early, late, compress,
  // etc.) recurse into value.target themselves. Eagerly querying targetEvents
  // here would double the work at every nesting level, causing O(2^n) blowup
  // for deeply nested patterns.
  let _targetEvents: PlaybackEvent[] | undefined;
  const targetEvents = (): PlaybackEvent[] => {
    if (_targetEvents === undefined) {
      _targetEvents = queryPattern(value.target, begin, end, context);
    }
    return _targetEvents;
  };

  switch (value.name) {
    case 'add':
      return applyNumericOperation(
        targetEvents(),
        value.args[0],
        begin,
        context,
        (left, right) => left + right,
      );
    case 'addIn':
      return applyAlignedOperation(value.target, value.args[0], begin, end, context, (a, b) => a + b, 'in');
    case 'addOut':
      return applyAlignedOperation(value.target, value.args[0], begin, end, context, (a, b) => a + b, 'out');
    case 'addMix':
      return applyAlignedOperation(value.target, value.args[0], begin, end, context, (a, b) => a + b, 'mix');
    case 'addSqueeze':
      return applyAlignedOperation(
        value.target,
        value.args[0],
        begin,
        end,
        context,
        (a, b) => a + b,
        'squeeze',
      );
    case 'addSqueezeout':
      return applyAlignedOperation(
        value.target,
        value.args[0],
        begin,
        end,
        context,
        (a, b) => a + b,
        'squeezeout',
      );
    case 'addReset':
      return applyAlignedOperation(
        value.target,
        value.args[0],
        begin,
        end,
        context,
        (a, b) => a + b,
        'reset',
      );
    case 'addRestart':
      return applyAlignedOperation(
        value.target,
        value.args[0],
        begin,
        end,
        context,
        (a, b) => a + b,
        'restart',
      );
    case 'div':
      return applyNumericOperation(targetEvents(), value.args[0], begin, context, (left, right) =>
        right === 0 ? 0 : left / right,
      );
    case 'compress':
      return transformCompress(
        value.target,
        begin,
        end,
        // Fallback 0/1 = full cycle range; safe because compress(0,1) is the identity transform
        evaluateNumericValue(value.args[0], begin) ?? 0,
        evaluateNumericValue(value.args[1], begin) ?? 1,
        context,
      );
    case 'chunk':
      return applyChunk(value.target, value.args[0], value.args[1], begin, end, context);
    case 'contract':
      return applyContract(value.target, value.args[0], begin, end, context);
    case 'fast':
      return transformFast(
        value.target,
        begin,
        end,
        // Fallback 1 = no speed change; factor of 1 is the identity for fast/slow
        evaluateNumericValue(value.args[0], begin) ?? 1,
        context,
      );
    case 'fastGap':
      return transformFastGap(
        value.target,
        begin,
        end,
        evaluateNumericValue(value.args[0], begin) ?? 1,
        context,
      );
    case 'slowGap':
      return transformSlowGap(
        value.target,
        begin,
        end,
        evaluateNumericValue(value.args[0], begin) ?? 1,
        context,
      );
    case 'slow':
      return transformSlow(
        value.target,
        begin,
        end,
        // Fallback 1 = no speed change (identity); ?? 0 would freeze playback
        evaluateNumericValue(value.args[0], begin) ?? 1,
        context,
      );
    case 'early':
      // Fallback 0 = no time shift; safe identity because early(0) leaves events in place
      return shiftEvents(
        queryPattern(
          value.target,
          begin + (evaluateNumericValue(value.args[0], begin) ?? 0),
          end + (evaluateNumericValue(value.args[0], begin) ?? 0),
          context,
        ),
        -(evaluateNumericValue(value.args[0], begin) ?? 0),
        begin,
        end,
      );
    case 'late':
      return shiftEvents(
        queryPattern(
          value.target,
          begin - (evaluateNumericValue(value.args[0], begin) ?? 0),
          end - (evaluateNumericValue(value.args[0], begin) ?? 0),
          context,
        ),
        evaluateNumericValue(value.args[0], begin) ?? 0,
        begin,
        end,
      );
    case 'hurry':
      // Semantic note: transformFast uses a single evaluated value for the whole query window,
      // while annotateEvents('speed', ...) resolves per-event via resolvePropertyValue.
      // For signal-driven hurry arguments this creates a mismatch — temporal compression
      // is uniform but speed annotation varies. True per-event temporal compression would
      // require a fundamentally different query architecture.
      return annotateEvents(
        transformFast(value.target, begin, end, evaluateNumericValue(value.args[0], begin) ?? 1, context),
        'speed',
        [value.args[0] ?? 1],
        context,
      );
    case 'grow':
      return applyGrow(value.target, value.args[0], begin, end, context);
    case 'linger':
      return transformLinger(
        value.target,
        begin,
        end,
        evaluateNumericValue(value.args[0], begin) ?? 1,
        context,
      );
    case 'mul':
      return applyNumericOperation(
        targetEvents(),
        value.args[0],
        begin,
        context,
        (left, right) => left * right,
      );
    case 'ply':
      // Fallback 1 = each event occupies its original slot (no subdivision)
      return applyPly(targetEvents(), evaluateNumericValue(value.args[0], begin) ?? 1);
    case 'degrade':
      return applyDegrade(targetEvents(), 0.5);
    case 'degradeBy':
      // Fallback 0.5 = 50% drop probability, matching the default `degrade` behavior
      return applyDegrade(targetEvents(), evaluateNumericValue(value.args[0], begin) ?? 0.5);
    case 'drop':
      return applyDrop(value.target, value.args[0], begin, end, context);
    case 'every':
      return applyEvery(targetEvents(), value.args[1], value.args[0], begin, end, context);
    case 'whenmod':
      return applyWhenMod(targetEvents(), value.args[2], value.args[0], value.args[1], begin, end, context);
    case 'legato':
      return applyLegato(targetEvents(), evaluateNumericValue(value.args[0], begin) ?? 1, begin, end);
    case 'stut':
      return applyStut(targetEvents(), value.args[0], value.args[1], value.args[2], begin, end);
    case 'spin':
      return applySpin(value.target, value.args[0], begin, end, context);
    case 'striate':
    case 'chop':
      return applyStriate(targetEvents(), value.args[0], begin);
    case 'fastspread':
      return applySpread(value.target, value.args, begin, end, context, false);
    case 'slowspread':
      return applySpread(value.target, value.args, begin, end, context, true);
    case 'fit':
      return applyFit(targetEvents(), value.args[0], value.args[1], begin);
    case 'bite':
      return applyBite(value.target, value.args[0], value.args[1], begin, end, context);
    case 'expand':
      return applyExpand(value.target, value.args[0], begin, end, context);
    case 'extend':
      return applyExtend(value.target, value.args[0], begin, end, context);
    case 'when':
      return applyWhen(targetEvents(), value.args[1], value.args[0], begin, end, context);
    case 'sometimesBy':
      return applySometimesBy(targetEvents(), value.args[1], value.args[0], begin, end, context);
    case 'within':
      return applyWithin(targetEvents(), value.args[2], value.args[0], value.args[1], begin, end, context);
    case 'zoom':
      return transformZoom(
        value.target,
        begin,
        end,
        evaluateNumericValue(value.args[0], begin) ?? 0,
        evaluateNumericValue(value.args[1], begin) ?? 1,
        context,
      );
    case 'rev':
      return transformRev(targetEvents(), begin, end);
    case 'palindrome':
      return transformPalindrome(value.target, targetEvents(), begin, end, context);
    case 'iter':
      return transformIter(
        value.target,
        begin,
        end,
        Math.max(1, Math.floor(evaluateNumericValue(value.args[0], begin) ?? 1)),
        false,
        context,
      );
    case 'iterBack':
    case 'iterback':
      return transformIter(
        value.target,
        begin,
        end,
        Math.max(1, Math.floor(evaluateNumericValue(value.args[0], begin) ?? 1)),
        true,
        context,
      );
    case 'inside':
      return transformInside(
        value.target,
        begin,
        end,
        evaluateNumericValue(value.args[0], begin) ?? 1,
        value.args[1],
        context,
      );
    case 'outside':
      return transformOutside(
        value.target,
        begin,
        end,
        evaluateNumericValue(value.args[0], begin) ?? 1,
        value.args[1],
        context,
      );
    case 'ribbon':
    case 'rib':
      return transformRibbon(
        value.target,
        begin,
        end,
        // Fallback 0/1 = view the full cycle; same rationale as compress/zoom defaults
        evaluateNumericValue(value.args[0], begin) ?? 0,
        evaluateNumericValue(value.args[1], begin) ?? 1,
        context,
      );
    case 'swingBy':
      return transformSwingBy(
        value.target,
        begin,
        end,
        evaluateNumericValue(value.args[0], begin) ?? 0,
        Math.max(1, Math.floor(evaluateNumericValue(value.args[1], begin) ?? 2)),
        context,
      );
    case 'swing':
      return transformSwingBy(
        value.target,
        begin,
        end,
        1 / 3,
        Math.max(1, Math.floor(evaluateNumericValue(value.args[0], begin) ?? 2)),
        context,
      );
    case 'cpm':
      return transformFast(
        value.target,
        begin,
        end,
        // Fallback 60 cpm / 60 = 1 cps (identity speed); avoids 0/60 which would halt playback
        (evaluateNumericValue(value.args[0], begin) ?? 60) / 60,
        context,
      );
    case 'sparsity':
      return transformSlow(
        value.target,
        begin,
        end,
        evaluateNumericValue(value.args[0], begin) ?? 1,
        context,
      );
    case 'density':
      return transformFast(
        value.target,
        begin,
        end,
        evaluateNumericValue(value.args[0], begin) ?? 1,
        context,
      );
    case 'euclidLegato':
      return applyEuclidLegato(
        value.target,
        begin,
        end,
        Math.max(0, Math.floor(evaluateNumericValue(value.args[0], begin) ?? 0)),
        Math.max(1, Math.floor(evaluateNumericValue(value.args[1], begin) ?? 1)),
        Math.floor(evaluateNumericValue(value.args[2], begin) ?? 0),
        context,
      );
    case 'euclidRot':
    case 'euclidrot':
      return applyEuclidRot(
        value.target,
        begin,
        end,
        Math.max(0, Math.floor(evaluateNumericValue(value.args[0], begin) ?? 0)),
        Math.max(1, Math.floor(evaluateNumericValue(value.args[1], begin) ?? 1)),
        Math.floor(evaluateNumericValue(value.args[2], begin) ?? 0),
        context,
      );
    case 'fmap':
      return applyFmap(targetEvents(), value.args[0], begin, context);
    case 'ceil':
      return mapNumericPayload(targetEvents(), Math.ceil);
    case 'floor':
      return mapNumericPayload(targetEvents(), Math.floor);
    case 'mask':
    case 'struct':
      return applyMask(targetEvents(), value.args[0], begin, end, context);
    case 'offset':
      return applyOffset(targetEvents(), evaluateNumericValue(value.args[0], begin) ?? 0);
    case 'pace':
      return applyPace(value.target, value.args[0], begin, end, context);
    case 'round':
      return mapNumericPayload(targetEvents(), Math.round);
    case 'rootNotes':
      return applyRootNotes(targetEvents(), value.args[0]);
    case 'scale':
      return applyScale(targetEvents(), value.args[0], begin, context);
    case 'scaleTranspose':
      return applyScaleTranspose(targetEvents(), value.args[0], begin, context);
    case 'segment':
      return applySegment(value.target, value.args[0], begin, end, context);
    case 'scramble':
      return rearrangeSlices(
        value.target,
        begin,
        end,
        Math.floor(evaluateNumericValue(value.args[0], begin) ?? 1),
        context,
        (count, cycleSeed) =>
          Array.from({ length: count }, (_, index) => {
            const random = seededRandom(
              cycleSeed * SEED_PRIME_CYCLE + index * SEED_PRIME_INDEX + hashString(context.channel),
            );
            return Math.min(count - 1, Math.floor(random * count));
          }),
      );
    case 'shuffle':
      return rearrangeSlices(
        value.target,
        begin,
        end,
        Math.floor(evaluateNumericValue(value.args[0], begin) ?? 1),
        context,
        (count, cycleSeed) => shuffledIndices(count, cycleSeed + hashString(context.channel)),
      );
    case 'shrink':
      return applyShrink(value.target, value.args[0], begin, end, context);
    case 'sub':
      return applyNumericOperation(
        targetEvents(),
        value.args[0],
        begin,
        context,
        (left, right) => left - right,
      );
    case 'take':
      return applyTake(value.target, value.args[0], begin, end, context);
    case 'tour':
      return applyTour(value.target, value.args, begin, end, context);
    case 'set':
      return applySet(targetEvents(), value.args[0], begin, context);
    case 'transpose':
      return applyTranspose(targetEvents(), value.args[0], begin, context);
    case 'voicing':
      return applyVoicing(targetEvents());
    default:
      if (PROPERTY_METHODS.has(value.name)) {
        return annotateEvents(targetEvents(), value.name, value.args, context);
      }
      throwUnsupportedPattern('method', value.name);
  }
}

function callPattern(
  property: 'chord' | 'i' | 'n' | 'note' | 's' | 'sound' | 'value',
  source: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const { channel } = context;
  if (typeof source === 'string') {
    return literalEvents(property, source, begin, end, channel);
  }

  if (typeof source === 'number') {
    return [{ begin, channel, duration: end - begin, end, payload: { [property]: source } }];
  }

  if (Array.isArray(source)) {
    return source.flatMap((entry) => callPattern(property, entry, begin, end, context));
  }

  if (isExpressionNode(source)) {
    if (source.exprType === 'signal') {
      return [
        {
          begin,
          channel,
          duration: end - begin,
          end,
          payload: { [property]: evaluateSignalExpression(source, begin) },
        },
      ];
    }
    return queryPattern(source, begin, end, context)
      .map((event) => remapEventPayload(event, property))
      .filter((event): event is PlaybackEvent => !!event);
  }

  return [];
}

function remapEventPayload(
  event: PlaybackEvent,
  property: 'chord' | 'i' | 'n' | 'note' | 's' | 'sound' | 'value',
): PlaybackEvent | undefined {
  if (property === 'value') {
    return event;
  }

  const payload = { ...event.payload };
  const mapped = payload.value;
  if (mapped === undefined && payload[property] === undefined) {
    return undefined;
  }
  delete payload.value;
  payload[property] = payload[property] ?? mapped;
  return { ...event, payload };
}

function applySet(
  currentEvents: PlaybackEvent[],
  value: ExpressionValue | undefined,
  begin: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  return currentEvents.map((event) => {
    const resolved = resolvePropertyValue(value, event.begin ?? begin, context.cps);
    return isPlainObject(resolved)
      ? { ...event, payload: { ...resolved, ...event.payload } }
      : { ...event, payload: { ...event.payload, set: resolved } };
  });
}

function applyPace(
  target: ExpressionValue,
  targetStepsExpr: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const currentSteps = inferStepCount(target, begin, context);
  const targetSteps = evaluateNumericValue(targetStepsExpr, begin);
  if (!currentSteps || !targetSteps || currentSteps <= 0 || targetSteps <= 0) {
    return queryPattern(target, begin, end, context);
  }
  return transformFast(target, begin, end, targetSteps / currentSteps, context);
}

function applyExpand(
  target: ExpressionValue,
  factorExpr: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  return applyStepwiseFactorTransform(
    target,
    factorExpr,
    begin,
    end,
    context,
    (currentSteps, factor) => currentSteps * factor,
    (_factor) => queryPattern(target, begin, end, context),
    (slotBegin, slotEnd) => queryPatternWithinCycleWindow(target, slotBegin, slotEnd, context),
  );
}

function applyContract(
  target: ExpressionValue,
  factorExpr: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  return applyStepwiseFactorTransform(
    target,
    factorExpr,
    begin,
    end,
    context,
    (currentSteps, factor) => currentSteps / factor,
    (_factor) => queryPattern(target, begin, end, context),
    (slotBegin, slotEnd) => queryPatternWithinCycleWindow(target, slotBegin, slotEnd, context),
  );
}

function applyExtend(
  target: ExpressionValue,
  factorExpr: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  return applyStepwiseFactorTransform(
    target,
    factorExpr,
    begin,
    end,
    context,
    (currentSteps, factor) => currentSteps * factor,
    (factor) => transformFast(target, begin, end, factor, context),
    (slotBegin, slotEnd, factor) =>
      transformFastWithinCycleWindow(target, slotBegin, slotEnd, factor, context),
  );
}

function applyTake(
  target: ExpressionValue,
  amountExpr: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const currentSteps = inferStepCount(target, begin, context);
  const amounts = resolveStepwiseNumberList(amountExpr, begin, context);
  if (!currentSteps || currentSteps <= 0 || amounts.length === 0) {
    return queryPattern(target, begin, end, context);
  }
  if (amounts.length === 1) {
    return applyTakeScalar(target, currentSteps, amounts[0] ?? 0, begin, end, context);
  }
  return queryStepSegments(
    amounts.map((amount) => ({
      render: (slotBegin: number, slotEnd: number) =>
        applyTakeScalar(target, currentSteps, amount, slotBegin, slotEnd, context),
      steps: clampStepCount(resolveTakeSteps(currentSteps, amount)),
    })),
    begin,
    end,
  );
}

function applyDrop(
  target: ExpressionValue,
  amountExpr: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const currentSteps = inferStepCount(target, begin, context);
  const amounts = resolveStepwiseNumberList(amountExpr, begin, context);
  if (!currentSteps || currentSteps <= 0 || amounts.length === 0) {
    return queryPattern(target, begin, end, context);
  }
  if (amounts.length === 1) {
    return applyDropScalar(target, currentSteps, amounts[0] ?? 0, begin, end, context);
  }
  return queryStepSegments(
    amounts.map((amount) => ({
      render: (slotBegin: number, slotEnd: number) =>
        applyDropScalar(target, currentSteps, amount, slotBegin, slotEnd, context),
      steps: clampStepCount(resolveDropSteps(currentSteps, amount)),
    })),
    begin,
    end,
  );
}

function applyTakeScalar(
  target: ExpressionValue,
  currentSteps: number,
  amount: number,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  if (currentSteps <= 0 || amount === 0) {
    return [];
  }
  const steps = Math.min(currentSteps, Math.abs(amount));
  if (steps <= 0) {
    return [];
  }
  if (steps >= currentSteps) {
    return queryPatternWithinCycleWindow(target, begin, end, context);
  }
  const fraction = steps / currentSteps;
  return amount < 0
    ? transformZoom(target, begin, end, 1 - fraction, 1, context)
    : transformZoom(target, begin, end, 0, fraction, context);
}

function applyDropScalar(
  target: ExpressionValue,
  currentSteps: number,
  amount: number,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  if (amount < 0) {
    return applyTakeScalar(target, currentSteps, currentSteps + amount, begin, end, context);
  }
  return applyTakeScalar(target, currentSteps, -(currentSteps - amount), begin, end, context);
}

function applyShrink(
  target: ExpressionValue,
  amountExpr: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const currentSteps = inferStepCount(target, begin, context);
  const amounts = resolveStepwiseNumberList(amountExpr, begin, context).filter((amount) => amount !== 0);
  if (!currentSteps || currentSteps <= 0 || amounts.length === 0) {
    return queryPattern(target, begin, end, context);
  }
  return queryStepSegments(
    amounts.flatMap((amount) => buildShrinkSegments(target, currentSteps, amount, context)),
    begin,
    end,
  );
}

function applyGrow(
  target: ExpressionValue,
  amountExpr: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const currentSteps = inferStepCount(target, begin, context);
  const amounts = resolveStepwiseNumberList(amountExpr, begin, context).filter((amount) => amount !== 0);
  if (!currentSteps || currentSteps <= 0 || amounts.length === 0) {
    return queryPattern(target, begin, end, context);
  }
  return queryStepSegments(
    amounts.flatMap((amount) => buildGrowSegments(target, currentSteps, amount, context)),
    begin,
    end,
  );
}

function buildShrinkSegments(
  target: ExpressionValue,
  currentSteps: number,
  amount: number,
  context: InternalQueryContext,
): Array<{ render: (slotBegin: number, slotEnd: number) => PlaybackEvent[]; steps: number }> {
  const stride = Math.abs(amount);
  if (!Number.isFinite(stride) || stride <= 0) {
    return [];
  }

  const segments: Array<{ render: (slotBegin: number, slotEnd: number) => PlaybackEvent[]; steps: number }> =
    [];
  for (let offset = 0; offset < currentSteps; offset += stride) {
    const remaining = clampStepCount(currentSteps - offset);
    if (remaining <= 0) {
      break;
    }
    const signedAmount = amount < 0 ? -offset : offset;
    segments.push({
      render: (slotBegin: number, slotEnd: number) =>
        applyDropScalar(target, currentSteps, signedAmount, slotBegin, slotEnd, context),
      steps: remaining,
    });
  }
  return segments;
}

function buildGrowSegments(
  target: ExpressionValue,
  currentSteps: number,
  amount: number,
  context: InternalQueryContext,
): Array<{ render: (slotBegin: number, slotEnd: number) => PlaybackEvent[]; steps: number }> {
  const stride = Math.abs(amount);
  if (!Number.isFinite(stride) || stride <= 0) {
    return [];
  }

  const segments: Array<{ render: (slotBegin: number, slotEnd: number) => PlaybackEvent[]; steps: number }> =
    [];
  for (let size = stride; size < currentSteps; size += stride) {
    const resolvedSteps = clampStepCount(Math.min(currentSteps, size));
    const signedAmount = amount < 0 ? -resolvedSteps : resolvedSteps;
    segments.push({
      render: (slotBegin: number, slotEnd: number) =>
        applyTakeScalar(target, currentSteps, signedAmount, slotBegin, slotEnd, context),
      steps: resolvedSteps,
    });
  }
  segments.push({
    render: (slotBegin: number, slotEnd: number) =>
      queryPatternWithinCycleWindow(target, slotBegin, slotEnd, context),
    steps: currentSteps,
  });
  return segments;
}

function applyTour(
  target: ExpressionValue,
  others: ExpressionValue[],
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const entries = others.flatMap((_, index, list) => [
    ...list.slice(0, list.length - index),
    target,
    ...list.slice(list.length - index),
  ]);
  return queryStepcat([...entries, target, ...others], begin, end, context);
}

function applyChunk(
  target: ExpressionValue,
  sizeExpr: ExpressionValue | undefined,
  transformedPattern: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const size = Math.max(1, Math.floor(evaluateNumericValue(sizeExpr, begin) ?? 1));
  // Math.max(1, ...) guarantees size >= 1 when finite; only NaN needs guarding.
  if (!Number.isFinite(size) || transformedPattern === undefined) {
    return queryPattern(target, begin, end, context);
  }

  const startCycle = Math.floor(begin);
  const endCycle = Math.ceil(end);
  const events: PlaybackEvent[] = [];

  for (let outputCycle = startCycle; outputCycle < endCycle; outputCycle += 1) {
    const sourceCycle = Math.floor(outputCycle / size);
    const chunkIndex = positiveMod(outputCycle, size);
    const chunkBegin = outputCycle + chunkIndex / size;
    const chunkEnd = outputCycle + (chunkIndex + 1) / size;
    const repeatedBase = queryRepeatedCycleWindow(target, sourceCycle, outputCycle, context);
    const repeatedTransformed = queryRepeatedCycleWindow(
      transformedPattern,
      sourceCycle,
      outputCycle,
      context,
    );

    for (const event of repeatedBase) {
      events.push(...excludeEventWindow(event, chunkBegin, chunkEnd, begin, end));
    }
    for (const event of repeatedTransformed) {
      const clipped = clipEvent(event, Math.max(begin, chunkBegin), Math.min(end, chunkEnd));
      if (clipped) {
        events.push(clipped);
      }
    }
  }

  return events.sort((left, right) => left.begin - right.begin || left.channel.localeCompare(right.channel));
}

function applySegment(
  target: ExpressionValue,
  value: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const segments = Math.max(1, Math.floor(evaluateNumericValue(value, begin) ?? 1));
  // Math.max(1, ...) guarantees segments >= 1 when finite; only NaN needs guarding.
  if (!Number.isFinite(segments)) {
    return queryPattern(target, begin, end, context);
  }

  return queryStepSegments(
    Array.from({ length: segments }, () => ({
      render: (slotBegin: number, slotEnd: number) => queryPattern(target, slotBegin, slotEnd, context),
      steps: 1,
    })),
    begin,
    end,
  );
}

function applyStepwiseFactorTransform(
  target: ExpressionValue,
  factorExpr: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
  resolveSteps: (currentSteps: number, factor: number) => number,
  renderFullWindow: (factor: number) => PlaybackEvent[],
  renderSegment: (slotBegin: number, slotEnd: number, factor: number) => PlaybackEvent[],
): PlaybackEvent[] {
  const factors = resolveStepwiseNumberList(factorExpr, begin, context).filter((factor) => factor > 0);
  if (factors.length === 0) {
    return queryPattern(target, begin, end, context);
  }
  if (factors.length === 1) {
    return renderFullWindow(factors[0] ?? 1);
  }
  const currentSteps = inferStepCount(target, begin, context) ?? 1;
  return queryStepSegments(
    factors.map((factor) => ({
      render: (slotBegin: number, slotEnd: number) => renderSegment(slotBegin, slotEnd, factor),
      steps: clampStepCount(resolveSteps(currentSteps, factor)),
    })),
    begin,
    end,
  );
}

function queryStepcat(
  entries: ExpressionValue[],
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const normalized = entries
    .map((entry) => normalizeStepcatEntry(entry, begin, context))
    .filter((entry): entry is { steps: number; value: ExpressionValue } => !!entry && entry.steps > 0);
  if (normalized.length === 0) {
    return [];
  }
  return queryStepSegments(
    normalized.map((entry) => ({
      render: (slotBegin: number, slotEnd: number) =>
        queryStepcatEntry(entry.value, slotBegin, slotEnd, context),
      steps: entry.steps,
    })),
    begin,
    end,
  );
}

function queryStepcatEntry(
  value: ExpressionValue,
  slotBegin: number,
  slotEnd: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  if (isExpressionNode(value)) {
    return queryPatternWithinCycleWindow(value, slotBegin, slotEnd, context);
  }
  if (typeof value === 'number' || isPlainObject(value)) {
    return queryCatEntry(value, slotBegin, slotEnd, context.channel, context.cps);
  }
  return queryPatternWithinCycleWindow(value, slotBegin, slotEnd, context);
}

function queryPatternWithinCycleWindow(
  target: ExpressionValue,
  slotBegin: number,
  slotEnd: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const cycleStart = Math.floor(slotBegin);
  return transformCompress(
    target,
    cycleStart,
    cycleStart + 1,
    slotBegin - cycleStart,
    slotEnd - cycleStart,
    context,
  );
}

function transformFastWithinCycleWindow(
  target: ExpressionValue,
  slotBegin: number,
  slotEnd: number,
  factor: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const cycleStart = Math.floor(slotBegin);
  return transformCompress(
    { args: [factor], exprType: 'pattern', kind: 'method', name: 'fast', target },
    cycleStart,
    cycleStart + 1,
    slotBegin - cycleStart,
    slotEnd - cycleStart,
    context,
  );
}

function queryStepalt(
  entries: ExpressionValue[],
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const groups = entries
    .map((entry) => (Array.isArray(entry) ? entry : [entry]))
    .filter((group) => group.length > 0);
  if (groups.length === 0) {
    return [];
  }
  const cycleCount = computeLcm(groups.map((group) => group.length));
  const alternated: ExpressionValue[] = [];
  for (let index = 0; index < cycleCount; index += 1) {
    for (const group of groups) {
      const selected = group[index % group.length];
      if (selected !== undefined) {
        alternated.push(selected);
      }
    }
  }
  return queryStepcat(alternated, begin, end, context);
}

function queryZip(
  entries: ExpressionValue[],
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const normalized = entries
    .map((entry) => ({ entry, steps: inferStepCount(entry, begin, context) }))
    .filter((entry): entry is { entry: ExpressionValue; steps: number } => !!entry.steps && entry.steps > 0);
  if (normalized.length === 0) {
    return [];
  }

  const rounds = computeLcm(normalized.map((entry) => entry.steps));
  const segments = [];
  for (let round = 0; round < rounds; round += 1) {
    for (const entry of normalized) {
      segments.push({
        render: (slotBegin: number, slotEnd: number) =>
          queryPatternStepSlice(entry.entry, entry.steps, round % entry.steps, slotBegin, slotEnd, context),
        steps: 1,
      });
    }
  }

  return queryStepSegments(segments, begin, end);
}

function queryPolymeter(
  entries: ExpressionValue[],
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const normalized = entries
    .map((entry) => ({ entry, steps: inferStepCount(entry, begin, context) }))
    .filter((entry): entry is { entry: ExpressionValue; steps: number } => !!entry.steps && entry.steps > 0);
  if (normalized.length === 0) {
    return [];
  }
  const steps = computeLcm(normalized.map((entry) => entry.steps));
  return normalized.flatMap((entry) => {
    if (entry.steps === steps) {
      return queryPattern(entry.entry, begin, end, context);
    }
    return transformFast(entry.entry, begin, end, steps / entry.steps, context);
  });
}

function queryPatternStepSlice(
  target: ExpressionValue,
  totalSteps: number,
  stepIndex: number,
  slotBegin: number,
  slotEnd: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const cycleStart = Math.floor(slotBegin);
  return remapCycleWindows(
    target,
    cycleStart,
    cycleStart + 1,
    context,
    stepIndex / totalSteps,
    (stepIndex + 1) / totalSteps,
    slotBegin - cycleStart,
    slotEnd - cycleStart,
  );
}

function queryStepSegments(
  segments: Array<{ render: (slotBegin: number, slotEnd: number) => PlaybackEvent[]; steps: number }>,
  begin: number,
  end: number,
): PlaybackEvent[] {
  const totalSteps = segments.reduce((sum, segment) => sum + segment.steps, 0);
  if (totalSteps <= 0) {
    return [];
  }

  const startCycle = Math.floor(begin);
  const endCycle = Math.ceil(end);
  const events: PlaybackEvent[] = [];

  for (let cycle = startCycle; cycle < endCycle; cycle += 1) {
    let cursor = 0;
    for (const segment of segments) {
      const slotBegin = cycle + cursor / totalSteps;
      const slotEnd = cycle + (cursor + segment.steps) / totalSteps;
      cursor += segment.steps;
      for (const event of segment.render(slotBegin, slotEnd)) {
        const clipped = clipEvent(event, begin, end);
        if (clipped) {
          events.push(clipped);
        }
      }
    }
  }

  return events;
}

function normalizeStepcatEntry(
  entry: ExpressionValue,
  begin: number,
  context: InternalQueryContext,
): { steps: number; value: ExpressionValue } | undefined {
  if (Array.isArray(entry) && entry.length === 2) {
    const [stepsExpr, value] = entry;
    const steps = evaluateNumericValue(stepsExpr, begin);
    return steps && steps > 0 && value !== undefined ? { steps, value } : undefined;
  }

  const steps = inferStepCount(entry, begin, context) ?? 1;
  return { steps, value: entry };
}

function inferStepCount(
  value: ExpressionValue | undefined,
  begin: number,
  context: InternalQueryContext,
): number | undefined {
  if (value === undefined || value === null || typeof value === 'boolean') {
    return undefined;
  }
  if (typeof value === 'number') {
    return 1;
  }
  if (typeof value === 'string') {
    return isAtomicMiniToken(value) ? 1 : inferMiniSteps(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? 0 : value.length;
  }
  if (!isExpressionNode(value)) {
    return undefined;
  }

  if (value.kind === 'call') {
    switch (value.name) {
      case 'silence':
        return 0;
      case 'value':
      case 'note':
      case 'n':
      case 'sound':
      case 's':
      case 'chord':
        return inferStepCount(value.args[0], begin, context);
      case 'seq':
      case 'sequence':
        return value.args.length;
      case 'stepcat':
        return value.args.reduce<number>(
          (sum, entry) => sum + (normalizeStepcatEntry(entry, begin, context)?.steps ?? 0),
          0,
        );
      case 'stepalt': {
        const groups = value.args
          .map((entry) => (Array.isArray(entry) ? entry : [entry]))
          .filter((group) => group.length > 0);
        if (groups.length === 0) {
          return 0;
        }
        const cycleCount = computeLcm(groups.map((group) => group.length));
        let total = 0;
        for (let index = 0; index < cycleCount; index += 1) {
          for (const group of groups) {
            total += inferStepCount(group[index % group.length], begin, context) ?? 1;
          }
        }
        return total;
      }
      case 'polymeter':
        return computeLcm(value.args.map((entry) => inferStepCount(entry, begin, context) ?? 1));
      default:
        return 1;
    }
  }

  const targetSteps = inferStepCount(value.target, begin, context);
  switch (value.name) {
    case 'pace':
      return evaluateNumericValue(value.args[0], begin) ?? targetSteps;
    case 'segment':
      return Math.max(1, Math.floor(evaluateNumericValue(value.args[0], begin) ?? targetSteps ?? 1));
    case 'expand':
    case 'extend': {
      if (!targetSteps) {
        return targetSteps;
      }
      const factors = resolveStepwiseNumberList(value.args[0], begin, context);
      return factors.length > 0
        ? targetSteps * factors.reduce((sum, factor) => sum + factor, 0)
        : targetSteps;
    }
    case 'contract': {
      if (!targetSteps) {
        return targetSteps;
      }
      const factors = resolveStepwiseNumberList(value.args[0], begin, context).filter(
        (factor) => factor !== 0,
      );
      return factors.length > 0
        ? factors.reduce((sum, factor) => sum + targetSteps / factor, 0)
        : targetSteps;
    }
    case 'take': {
      if (!targetSteps) {
        return targetSteps;
      }
      const amounts = resolveStepwiseNumberList(value.args[0], begin, context);
      return amounts.length > 0
        ? amounts.reduce((sum, amount) => sum + resolveTakeSteps(targetSteps, amount), 0)
        : targetSteps;
    }
    case 'drop': {
      if (!targetSteps) {
        return targetSteps;
      }
      const amounts = resolveStepwiseNumberList(value.args[0], begin, context);
      return amounts.length > 0
        ? amounts.reduce((sum, amount) => sum + resolveDropSteps(targetSteps, amount), 0)
        : targetSteps;
    }
    default:
      return targetSteps;
  }
}

function resolveStepwiseNumberList(
  value: ExpressionValue | undefined,
  begin: number,
  context: InternalQueryContext,
): number[] {
  if (value === undefined) {
    return [];
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [value] : [];
  }

  return queryCatEntry(value, begin, begin + 1, `${context.channel}:steps`, context.cps)
    .map((event) => {
      const candidate = event.payload.value ?? event.payload.n ?? event.payload.note;
      return typeof candidate === 'number' ? candidate : Number(candidate);
    })
    .filter((entry) => Number.isFinite(entry));
}

function resolveTakeSteps(currentSteps: number, amount: number): number {
  if (currentSteps <= 0 || amount === 0) {
    return 0;
  }
  return Math.min(currentSteps, Math.abs(amount));
}

function resolveDropSteps(currentSteps: number, amount: number): number {
  if (amount < 0) {
    return resolveTakeSteps(currentSteps, currentSteps + amount);
  }
  return resolveTakeSteps(currentSteps, currentSteps - amount);
}

function clampStepCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function computeLcm(values: number[]): number {
  const normalized = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.round(value))
    .filter((value) => value > 0);
  if (normalized.length === 0) {
    return 1;
  }
  return normalized.reduce((accumulator, value) => leastCommonMultiple(accumulator, value));
}

function queryCat(
  entries: ExpressionValue[],
  begin: number,
  end: number,
  channel: string,
  cps = 1,
): PlaybackEvent[] {
  if (entries.length === 0) {
    return [];
  }

  const startCycle = Math.floor(begin);
  const endCycle = Math.ceil(end);
  const events: PlaybackEvent[] = [];

  for (let cycle = startCycle; cycle < endCycle; cycle += 1) {
    const slotBegin = cycle;
    const slotEnd = cycle + 1;
    const slotEvents = queryCatEntry(
      entries[((cycle % entries.length) + entries.length) % entries.length],
      slotBegin,
      slotEnd,
      channel,
      cps,
    );

    for (const event of slotEvents) {
      const clipped = clipEvent(event, begin, end);
      if (clipped) {
        events.push(clipped);
      }
    }
  }

  return events;
}

function querySequence(
  entries: ExpressionValue[],
  begin: number,
  end: number,
  channel: string,
  cps = 1,
): PlaybackEvent[] {
  if (entries.length === 0) {
    return [];
  }

  const startCycle = Math.floor(begin);
  const endCycle = Math.ceil(end);
  const events: PlaybackEvent[] = [];
  const slotSize = 1 / entries.length;

  for (let cycle = startCycle; cycle < endCycle; cycle += 1) {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === undefined) {
        continue;
      }
      const slotBegin = cycle + index * slotSize;
      const slotEnd = slotBegin + slotSize;
      const slotEvents = queryCatEntry(entry, slotBegin, slotEnd, channel, cps);
      for (const event of slotEvents) {
        const clipped = clipEvent(event, begin, end);
        if (clipped) {
          events.push(clipped);
        }
      }
    }
  }

  return events;
}

function queryChoose(
  entries: ExpressionValue[],
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const normalized = entries
    .map((entry) => normalizeWeightedEntry(entry))
    .filter((entry): entry is { value: ExpressionValue; weight: number } => !!entry && entry.weight > 0);
  if (normalized.length === 0) {
    return [];
  }

  const startCycle = Math.floor(begin);
  const endCycle = Math.ceil(end);
  const totalWeight = normalized.reduce((sum, entry) => sum + entry.weight, 0);
  const events: PlaybackEvent[] = [];

  for (let cycle = startCycle; cycle < endCycle; cycle += 1) {
    const seed = seededRandom(cycle * 97 + hashString(context.channel));
    let threshold = seed * totalWeight;
    let selected = normalized[normalized.length - 1];
    for (const entry of normalized) {
      threshold -= entry.weight;
      if (threshold <= 0) {
        selected = entry;
        break;
      }
    }
    const slotEvents = queryCatEntry(selected?.value, cycle, cycle + 1, context.channel, context.cps);
    for (const event of slotEvents) {
      const clipped = clipEvent(event, begin, end);
      if (clipped) {
        events.push(clipped);
      }
    }
  }

  return events;
}

function queryCatEntry(
  entry: ExpressionValue | undefined,
  begin: number,
  end: number,
  channel: string,
  cps = 1,
): PlaybackEvent[] {
  if (entry === undefined) {
    return [];
  }

  if (isExpressionNode(entry)) {
    return queryPattern(entry, begin, end, { channel, cps });
  }

  if (isPlainObject(entry)) {
    return [
      {
        begin,
        channel,
        duration: end - begin,
        end,
        payload: entry,
      },
    ];
  }

  if (typeof entry === 'number') {
    return [
      {
        begin,
        channel,
        duration: end - begin,
        end,
        payload: { value: entry },
      },
    ];
  }

  if (typeof entry === 'string') {
    if (isAtomicMiniToken(entry)) {
      return [
        {
          begin,
          channel,
          duration: end - begin,
          end,
          payload: { value: entry },
        },
      ];
    }
    return literalEvents('value', entry, begin, end, channel);
  }
  return [];
}

function isAtomicMiniToken(value: string): boolean {
  return value.trim().length > 0 && !/[\s,[\]<>*/!@]/.test(value);
}

function excludeEventWindow(
  event: PlaybackEvent,
  windowBegin: number,
  windowEnd: number,
  begin: number,
  end: number,
): PlaybackEvent[] {
  const events: PlaybackEvent[] = [];
  const left = clipEvent(event, begin, Math.min(end, windowBegin));
  if (left) {
    events.push(left);
  }
  const right = clipEvent(event, Math.max(begin, windowEnd), end);
  if (right) {
    events.push(right);
  }
  return events;
}

function literalEvents(
  property: string,
  source: string,
  begin: number,
  end: number,
  channel: string,
): PlaybackEvent[] {
  const events = queryMini(source, begin, end);
  return events.map((event) => ({
    begin: event.begin,
    channel,
    duration: event.end - event.begin,
    end: event.end,
    payload: { [property]: coerceMiniValue(event.value) },
  }));
}

function rearrangeSlices(
  target: ExpressionValue,
  begin: number,
  end: number,
  slices: number,
  context: InternalQueryContext,
  orderForCycle: (count: number, cycleSeed: number) => number[],
): PlaybackEvent[] {
  const count = Math.max(1, slices);
  if (count === 1) {
    return queryPattern(target, begin, end, context);
  }
  const width = 1 / count;
  const startCycle = Math.floor(begin);
  const endCycle = Math.ceil(end);
  const events: PlaybackEvent[] = [];

  for (let cycle = startCycle; cycle < endCycle; cycle += 1) {
    const order = orderForCycle(count, cycle);
    for (let index = 0; index < count; index += 1) {
      const sourceIndex = order[index] ?? index;
      const sourceBegin = cycle + sourceIndex * width;
      const sourceEnd = sourceBegin + width;
      const destBegin = cycle + index * width;
      const remapped = queryPattern(target, sourceBegin, sourceEnd, context).map((event) => ({
        ...event,
        begin: destBegin + (event.begin - sourceBegin),
        end: destBegin + (event.end - sourceBegin),
      }));
      for (const event of remapped) {
        const clipped = clipEvent(event, begin, end);
        if (clipped) {
          events.push(clipped);
        }
      }
    }
  }

  return events.sort((left, right) => left.begin - right.begin || left.channel.localeCompare(right.channel));
}

function applyMask(
  currentEvents: PlaybackEvent[],
  maskExpr: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const maskEvents = queryValueEvents(maskExpr, begin, end, context);
  return currentEvents.filter((event) =>
    maskEvents.some(
      (maskEvent) =>
        event.begin >= maskEvent.begin && event.begin < maskEvent.end && isTruthyMaskValue(maskEvent.value),
    ),
  );
}

function applyPly(currentEvents: PlaybackEvent[], count: number): PlaybackEvent[] {
  const resolvedCount = Math.max(1, Math.floor(count));
  if (resolvedCount <= 1) {
    return currentEvents;
  }

  return currentEvents.flatMap((event) => {
    const width = event.duration / resolvedCount;
    return Array.from({ length: resolvedCount }, (_, index) => {
      const begin = event.begin + width * index;
      return {
        ...event,
        begin,
        duration: width,
        end: begin + width,
      };
    });
  });
}

function applyDegrade(currentEvents: PlaybackEvent[], amount: number): PlaybackEvent[] {
  const probability = clampNumber(amount, 0, 1, 0.5);
  return currentEvents.filter((event) => seededRandom(hashEvent(event)) >= probability);
}

function applyEvery(
  currentEvents: PlaybackEvent[],
  transformedPattern: ExpressionValue | undefined,
  everyN: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const cycles = Math.max(1, Math.floor(evaluateNumericValue(everyN, begin) ?? 1));
  return replaceEventsByWindow(
    currentEvents,
    transformedPattern,
    begin,
    end,
    context,
    (value) => positiveMod(Math.floor(value), cycles) === 0,
  );
}

/**
 * whenmod(n, t, fn): like `every`, but the transform applies during the last
 * `t` cycles of every group of `n` cycles (Tidal semantics).
 */
function applyWhenMod(
  currentEvents: PlaybackEvent[],
  transformedPattern: ExpressionValue | undefined,
  everyN: ExpressionValue | undefined,
  activeN: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const cycles = Math.max(1, Math.floor(evaluateNumericValue(everyN, begin) ?? 1));
  const active = clampNumber(Math.floor(evaluateNumericValue(activeN, begin) ?? 1), 1, cycles, 1);
  return replaceEventsByWindow(
    currentEvents,
    transformedPattern,
    begin,
    end,
    context,
    (value) => positiveMod(Math.floor(value), cycles) >= cycles - active,
  );
}

/** legato(k): scale event durations (and their end points) by k. */
function applyLegato(
  currentEvents: PlaybackEvent[],
  factor: number,
  begin: number,
  end: number,
): PlaybackEvent[] {
  if (!Number.isFinite(factor) || factor <= 0) {
    return [];
  }
  return currentEvents
    .map((event) => {
      const duration = event.duration * factor;
      return { ...event, duration, end: event.begin + duration };
    })
    .filter((event) => event.end > begin && event.begin < end);
}

/**
 * stut(count, time, feedback): echo each event `count` times at `time`-cycle
 * intervals, scaling gain by `feedback` per echo.
 */
function applyStut(
  currentEvents: PlaybackEvent[],
  countValue: ExpressionValue | undefined,
  timeValue: ExpressionValue | undefined,
  feedbackValue: ExpressionValue | undefined,
  begin: number,
  end: number,
): PlaybackEvent[] {
  const count = Math.max(1, Math.floor(evaluateNumericValue(countValue, begin) ?? 1));
  const stepTime = evaluateNumericValue(timeValue, begin) ?? 0.125;
  const feedback = clampNumber(evaluateNumericValue(feedbackValue, begin) ?? 0.5, 0, 1, 0.5);
  const result: PlaybackEvent[] = [...currentEvents];
  for (const event of currentEvents) {
    for (let index = 1; index <= count; index += 1) {
      const shifted = {
        ...event,
        begin: event.begin + stepTime * index,
        end: event.end + stepTime * index,
        payload: {
          ...event.payload,
          gain:
            typeof event.payload.gain === 'number'
              ? event.payload.gain * feedback ** index
              : feedback ** index,
        },
      };
      if (shifted.end > begin && shifted.begin < end) {
        result.push(shifted);
      }
    }
  }
  return result;
}

/**
 * spin(n): layer the target n times; layer k is panned across the stereo
 * field and rhythmically rotated by k/n cycles.
 */
function applySpin(
  target: ExpressionValue,
  layersValue: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const layers = Math.max(1, Math.floor(evaluateNumericValue(layersValue, begin) ?? 1));
  const result: PlaybackEvent[] = [];
  for (let layer = 0; layer < layers; layer += 1) {
    const rotation = layer / layers;
    const pan = layers > 1 ? (layer / (layers - 1)) * 2 - 1 : 0;
    const shifted = shiftEvents(
      queryPattern(target, begin + rotation, end + rotation, context),
      -rotation,
      begin,
      end,
    ).map((event) => ({ ...event, payload: { ...event.payload, pan } }));
    result.push(...shifted);
  }
  return result;
}

/**
 * striate(n) / chop(n): split each event into n sequential slices spanning
 * the original window; each slice plays the matching fraction of the sample
 * (via begin/end window annotations).
 */
function applyStriate(
  currentEvents: PlaybackEvent[],
  countValue: ExpressionValue | undefined,
  begin: number,
): PlaybackEvent[] {
  const slices = Math.max(1, Math.floor(evaluateNumericValue(countValue, begin) ?? 1));
  const result: PlaybackEvent[] = [];
  for (const event of currentEvents) {
    const sliceDuration = event.duration / slices;
    for (let slice = 0; slice < slices; slice += 1) {
      result.push({
        ...event,
        begin: event.begin + sliceDuration * slice,
        duration: sliceDuration,
        end: event.begin + sliceDuration * (slice + 1),
        payload: {
          ...event.payload,
          begin: slice / slices,
          end: (slice + 1) / slices,
        },
      });
    }
  }
  return result;
}

/**
 * fastspread / slowspread: stack the target once per factor, each copy
 * time-scaled by that factor (`fast(k)` / `slow(k)`).
 *
 * Factors are collected from the arguments — plain numbers and/or nested
 * arrays of numbers, e.g. `.fastspread(0.5, [0.75, 1], 2)`.
 */
function applySpread(
  target: ExpressionValue,
  args: readonly ExpressionValue[],
  begin: number,
  end: number,
  context: InternalQueryContext,
  slow: boolean,
): PlaybackEvent[] {
  const factors: number[] = [];
  for (const entry of args) {
    const entries = Array.isArray(entry) ? entry : [entry];
    for (const item of entries) {
      const factor = evaluateNumericValue(item as ExpressionValue, begin);
      if (factor !== undefined && Number.isFinite(factor) && factor > 0) {
        factors.push(factor);
      }
    }
  }
  if (factors.length === 0) {
    return [];
  }
  return factors.flatMap((factor) =>
    slow
      ? transformSlow(target, begin, end, factor, context)
      : transformFast(target, begin, end, factor, context),
  );
}

/**
 * fit(size, table): map the target's integer step values through a lookup
 * table. Only the first `size` entries are addressable; indices wrap
 * modulo that limit.
 */
function applyFit(
  currentEvents: PlaybackEvent[],
  sizeValue: ExpressionValue | undefined,
  tableValue: ExpressionValue | undefined,
  begin: number,
): PlaybackEvent[] {
  const rawTable = Array.isArray(tableValue) ? tableValue : tableValue === undefined ? [] : [tableValue];
  const table: number[] = [];
  for (const entry of rawTable) {
    const numeric = evaluateNumericValue(entry as ExpressionValue, begin);
    if (numeric !== undefined) {
      table.push(numeric);
    }
  }
  if (table.length === 0) {
    return currentEvents;
  }
  const limit = Math.max(
    1,
    Math.min(Math.floor(evaluateNumericValue(sizeValue, begin) ?? table.length), table.length),
  );
  const stepKeys = ['n', 'i', 'value', 'note'] as const;
  return currentEvents.map((event) => {
    const stepKey = stepKeys.find((key) => typeof event.payload[key] === 'number');
    if (!stepKey) {
      return event;
    }
    const mapped = table[positiveMod(Math.trunc(event.payload[stepKey] as number), limit)];
    if (mapped === undefined) {
      return event;
    }
    return { ...event, payload: { ...event.payload, [stepKey]: mapped } };
  });
}

/**
 * bite(count, generator): divides each cycle into `count` slices; the
 * generator pattern's integer events pick which slice of the target plays
 * during their span.
 */
function applyBite(
  target: ExpressionValue,
  countValue: ExpressionValue | undefined,
  generatorValue: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const slices = Math.max(1, Math.floor(evaluateNumericValue(countValue, begin) ?? 1));
  const generatorEvents = queryValueEvents(generatorValue, begin, end, context);
  const result: PlaybackEvent[] = [];
  for (const generatorEvent of generatorEvents) {
    const index = positiveMod(Math.trunc(Number(generatorEvent.value) || 0), slices);
    const outBegin = Math.max(generatorEvent.begin, begin);
    const outEnd = Math.min(generatorEvent.end, end);
    if (outEnd <= outBegin) {
      continue;
    }
    result.push(...transformZoom(target, outBegin, outEnd, index / slices, (index + 1) / slices, context));
  }
  return result;
}

function applyWhen(
  currentEvents: PlaybackEvent[],
  transformedPattern: ExpressionValue | undefined,
  condition: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const maskEvents = queryValueEvents(condition, begin, end, context);
  return replaceEventsByWindow(currentEvents, transformedPattern, begin, end, context, (value) =>
    maskEvents.some(
      (maskEvent) => value >= maskEvent.begin && value < maskEvent.end && isTruthyMaskValue(maskEvent.value),
    ),
  );
}

function applySometimesBy(
  currentEvents: PlaybackEvent[],
  transformedPattern: ExpressionValue | undefined,
  probabilityExpr: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  return replaceEventsByWindow(currentEvents, transformedPattern, begin, end, context, (value) => {
    const cycle = Math.floor(value);
    // Fallback 0.5 = coin-flip probability; matches Tidal/Strudel convention for sometimesBy
    const probability = clampNumber(evaluateNumericValue(probabilityExpr, value) ?? 0.5, 0, 1, 0.5);
    return seededRandom(cycle * 131 + hashString(context.channel)) < probability;
  });
}

function applyWithin(
  currentEvents: PlaybackEvent[],
  transformedPattern: ExpressionValue | undefined,
  windowBeginExpr: ExpressionValue | undefined,
  windowEndExpr: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  return replaceEventsByWindow(currentEvents, transformedPattern, begin, end, context, (value) => {
    const phase = value - Math.floor(value);
    const windowBegin = normalizeCyclePhase(evaluateNumericValue(windowBeginExpr, value) ?? 0);
    const windowEnd = normalizeCyclePhase(evaluateNumericValue(windowEndExpr, value) ?? 1);
    if (windowBegin === windowEnd) {
      return true;
    }
    if (windowBegin < windowEnd) {
      return phase >= windowBegin && phase < windowEnd;
    }
    return phase >= windowBegin || phase < windowEnd;
  });
}

function replaceEventsByWindow(
  currentEvents: PlaybackEvent[],
  transformedPattern: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
  shouldReplace: (time: number) => boolean,
): PlaybackEvent[] {
  if (!transformedPattern) {
    return currentEvents;
  }
  const transformedEvents = queryPattern(transformedPattern, begin, end, context);
  return [
    ...currentEvents.filter((event) => !shouldReplace(event.begin)),
    ...transformedEvents.filter((event) => shouldReplace(event.begin)),
  ].sort((left, right) => left.begin - right.begin || left.channel.localeCompare(right.channel));
}

function applyNumericOperation(
  currentEvents: PlaybackEvent[],
  operand: ExpressionValue | undefined,
  cycle: number,
  _context: InternalQueryContext,
  operator: (left: number, right: number) => number,
): PlaybackEvent[] {
  return currentEvents.map((event) => {
    const [key, value] = firstPayloadEntry(event.payload);
    if (!key || typeof value !== 'number') {
      return event;
    }
    const right = evaluateNumericValue(operand, event.begin) ?? evaluateNumericValue(operand, cycle);
    if (right === undefined) {
      return event;
    }
    return { ...event, payload: { ...event.payload, [key]: operator(value, right) } };
  });
}

function applyOffset(currentEvents: PlaybackEvent[], amount: number): PlaybackEvent[] {
  if (!Number.isFinite(amount) || amount === 0) {
    return currentEvents;
  }
  return currentEvents.map((event) => {
    const payload = { ...event.payload };
    if (typeof payload.note === 'number') {
      payload.note += amount;
    }
    if (typeof payload.n === 'number') {
      payload.n += amount;
    }
    return { ...event, payload };
  });
}

function annotateEvents(
  currentEvents: PlaybackEvent[],
  property: string,
  args: ExpressionValue[],
  context: InternalQueryContext,
): PlaybackEvent[] {
  return currentEvents.map((event) => {
    const payload = { ...event.payload };

    if ((property === 'note' || property === 'sound' || property === 's') && args.length === 0) {
      const plainValue = extractEventValue(payload);
      delete payload.value;
      payload[property] = plainValue;
      return { ...event, payload };
    }

    const resolvedValue = resolvePropertyValue(args[0], event.begin, context.cps);
    payload[property] = resolvedValue;

    if (property === 'clip' && typeof resolvedValue === 'number' && Number.isFinite(resolvedValue)) {
      return {
        ...event,
        duration: event.duration * clampNumber(resolvedValue, MIN_CLIP_RATIO, 1, 1),
        payload,
      };
    }

    return { ...event, payload };
  });
}
