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
import { isChannelAudible } from './channel-state.js';
import {
  annotateEvents,
  applyBite,
  applyEvery,
  applyFit,
  applyLegato,
  applySometimesBy,
  applySpin,
  applySpread,
  applyStriate,
  applyStut,
  applyWhen,
  applyWhenMod,
  applyWithin,
  MIN_CLIP_RATIO,
  replaceEventsByWindow,
} from './conditionals.js';
import { collectExternalDispatches } from './dispatch.js';
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
  applyChunk,
  applyContract,
  applyDegrade,
  applyDrop,
  applyExpand,
  applyExtend,
  applyGrow,
  applyMask,
  applyNumericOperation,
  applyOffset,
  applyPace,
  applyPly,
  applySegment,
  applySet,
  applyShrink,
  applyStepwiseFactorTransform,
  applyTake,
  applyTour,
  callPattern,
  literalEvents,
  queryCat,
  queryChoose,
  queryPolymeter,
  querySequence,
  queryStepalt,
  queryStepcat,
  queryZip,
  rearrangeSlices,
  remapEventPayload,
} from './structure.js';

export {
  clearMixState,
  getChannelRuntimeSnapshot,
  isChannelAudible,
  isHushed,
  resetChannelRuntimeState,
  setChannelMuted,
  setChannelSolo,
  setHush,
  toggleChannelMute,
  toggleChannelSolo,
} from './channel-state.js';
export { collectExternalDispatches };

import { DEFAULT_MIDI_VALUE } from './constants.js';
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

function queryChannel(
  channelName: string,
  channel: ChannelSpec,
  begin: number,
  end: number,
  context: QueryContext,
): PlaybackEvent[] {
  if (!isChannelAudible(channelName)) {
    return [];
  }
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

/**
 * whenmod(n, t, fn): like `every`, but the transform applies during the last
 * `t` cycles of every group of `n` cycles (Tidal semantics).
 */

/** legato(k): scale event durations (and their end points) by k. */

/**
 * stut(count, time, feedback): echo each event `count` times at `time`-cycle
 * intervals, scaling gain by `feedback` per echo.
 */

/**
 * spin(n): layer the target n times; layer k is panned across the stereo
 * field and rhythmically rotated by k/n cycles.
 */

/**
 * striate(n) / chop(n): split each event into n sequential slices spanning
 * the original window; each slice plays the matching fraction of the sample
 * (via begin/end window annotations).
 */

/**
 * fastspread / slowspread: stack the target once per factor, each copy
 * time-scaled by that factor (`fast(k)` / `slow(k)`).
 *
 * Factors are collected from the arguments — plain numbers and/or nested
 * arrays of numbers, e.g. `.fastspread(0.5, [0.75, 1], 2)`.
 */

/**
 * fit(size, table): map the target's integer step values through a lookup
 * table. Only the first `size` entries are addressable; indices wrap
 * modulo that limit.
 */

/**
 * bite(count, generator): divides each cycle into `count` slices; the
 * generator pattern's integer events pick which slice of the target plays
 * during their span.
 */
