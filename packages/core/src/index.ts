import { Chord, Interval, Note, Scale } from '@tonaljs/tonal';
import {
  type ChannelSpec,
  type ExpressionNode,
  type ExpressionValue,
  getInputValue,
  isExpressionNode,
  isPlainObject,
  resolveGamepadInputKey,
  resolveInputKey,
  resolveMidiInputKey,
  resolveMotionInputKey,
  type SceneSpec,
} from '@tussel/ir';
import { inferMiniSteps, queryMini } from '@tussel/mini';

export {
  centsToRatio,
  createEdoScale,
  edoFrequency,
  parseXenValue,
  ratioToCents,
  resolveEdoFrequency,
} from './xen.js';

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

export interface OscDispatchEvent extends ExternalDispatchEventBase {
  host: string;
  kind: 'osc';
  path: string;
  port: number;
}

export type ExternalDispatchEvent = MidiCcDispatchEvent | MidiNoteDispatchEvent | OscDispatchEvent;

export interface SchedulerOptions {
  clearIntervalFn?: typeof clearInterval;
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
  setIntervalFn?: typeof setInterval;
  /**
   * Duration of each scheduling window (tick quantum) in seconds.
   * Default: 0.05 (50 ms). Controls how many cycles of audio are queried
   * per tick. Smaller windows give finer granularity; larger windows
   * reduce overhead.
   */
  windowDuration?: number;
}

interface InternalQueryContext extends QueryContext {
  channel: string;
}

const PROPERTY_METHODS = new Set([
  'anchor',
  'attack',
  'bank',
  'begin',
  'clip',
  'cut',
  'cutoff',
  'csound',
  'csoundm',
  'decay',
  'delay',
  'dict',
  'edo',
  'end',
  'fm',
  'gain',
  'hpf',
  'hcutoff',
  'lpf',
  'loop',
  'lpq',
  'mode',
  'midichan',
  'midicc',
  'midiport',
  'midivalue',
  'note',
  'offset',
  'osc',
  'oschost',
  'oscport',
  'orbit',
  'pan',
  'phaser',
  'release',
  'room',
  's',
  'segment',
  'set',
  'shape',
  'size',
  'sound',
  'speed',
  'struct',
  'sustain',
  'velocity',
]);

const warnedUnsupportedPatterns = new Set<string>();
const warnedChannelErrors = new Set<string>();

function warnChannelError(channelName: string, error: unknown): void {
  if (warnedChannelErrors.has(channelName)) {
    return;
  }
  warnedChannelErrors.add(channelName);
  console.warn(
    `[tussel/core] channel "${channelName}" evaluation failed: ${(error as Error).message ?? error}`,
  );
}

export function evaluateNumericValue(value: ExpressionValue | undefined, cycle: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return evaluateMiniNumber(value, cycle);
  }

  if (typeof value === 'boolean' || value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return evaluateNumericValue(value[0], cycle);
  }

  if (!isExpressionNode(value)) {
    return undefined;
  }

  if (value.exprType === 'signal') {
    return evaluateSignalExpression(value, cycle);
  }

  const resolved = evaluatePatternValue(value, cycle);
  return typeof resolved === 'number' ? resolved : undefined;
}

function warnUnsupportedPattern(kind: 'call' | 'method', name: string): void {
  const key = `${kind}:${name}`;
  if (warnedUnsupportedPatterns.has(key)) {
    return;
  }
  warnedUnsupportedPatterns.add(key);
  const behavior = kind === 'call' ? 'returns silence' : 'leaves events unchanged';
  console.warn(`[tussel/core] unsupported pattern ${kind} "${name}" currently ${behavior}.`);
}

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
  const midiCc = coerceDispatchNumber(event.payload.midicc);

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
  } else {
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
  const numeric = coerceDispatchNumber(value);
  if (numeric === undefined) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function coerceDispatchNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const numeric = Number(value.trim());
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
}

function resolveMidiCcValue(payload: Record<string, unknown>): number {
  return (
    coerceDispatchNumber(payload.midivalue) ??
    coerceDispatchNumber(payload.value) ??
    normalizeMidiScalar(coerceDispatchNumber(payload.velocity)) ??
    normalizeMidiScalar(coerceDispatchNumber(payload.gain)) ??
    102
  );
}

function resolveMidiVelocity(payload: Record<string, unknown>): number {
  return (
    normalizeMidiScalar(coerceDispatchNumber(payload.velocity) ?? coerceDispatchNumber(payload.gain)) ?? 102
  );
}

function normalizeMidiScalar(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value >= 0 && value <= 1 ? value * 127 : value;
}

function resolveMidiDispatchNote(payload: Record<string, unknown>): number | undefined {
  const frequency = coerceDispatchNumber(payload.freq);
  if (frequency !== undefined && frequency > 0) {
    return 69 + 12 * Math.log2(frequency / 440);
  }

  const numericNote = coerceDispatchNumber(payload.note ?? payload.n);
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

function queryPattern(
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
      case 'chord':
      case 'value':
        return callPattern(value.name, value.args[0], begin, end, context);
      default:
        warnUnsupportedPattern('call', value.name);
        return [];
    }
  }

  const targetEvents = queryPattern(value.target, begin, end, context);

  switch (value.name) {
    case 'add':
      return applyNumericOperation(
        targetEvents,
        value.args[0],
        begin,
        context,
        (left, right) => left + right,
      );
    case 'div':
      return applyNumericOperation(
        targetEvents,
        value.args[0],
        begin,
        context,
        (left, right) => left / right,
      );
    case 'compress':
      return transformCompress(
        value.target,
        begin,
        end,
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
        evaluateNumericValue(value.args[0], begin) ?? 1,
        context,
      );
    case 'early':
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
        targetEvents,
        value.args[0],
        begin,
        context,
        (left, right) => left * right,
      );
    case 'ply':
      return applyPly(targetEvents, evaluateNumericValue(value.args[0], begin) ?? 1);
    case 'degrade':
      return applyDegrade(targetEvents, 0.5);
    case 'degradeBy':
      return applyDegrade(targetEvents, evaluateNumericValue(value.args[0], begin) ?? 0.5);
    case 'drop':
      return applyDrop(value.target, value.args[0], begin, end, context);
    case 'every':
      return applyEvery(targetEvents, value.args[1], value.args[0], begin, end, context);
    case 'expand':
      return applyExpand(value.target, value.args[0], begin, end, context);
    case 'extend':
      return applyExtend(value.target, value.args[0], begin, end, context);
    case 'when':
      return applyWhen(targetEvents, value.args[1], value.args[0], begin, end, context);
    case 'sometimesBy':
      return applySometimesBy(targetEvents, value.args[1], value.args[0], begin, end, context);
    case 'within':
      return applyWithin(targetEvents, value.args[2], value.args[0], value.args[1], begin, end, context);
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
      return transformRev(targetEvents, begin, end);
    case 'ceil':
      return mapNumericPayload(targetEvents, Math.ceil);
    case 'floor':
      return mapNumericPayload(targetEvents, Math.floor);
    case 'mask':
    case 'struct':
      return applyMask(targetEvents, value.args[0], begin, end, context);
    case 'offset':
      return applyOffset(targetEvents, evaluateNumericValue(value.args[0], begin) ?? 0);
    case 'pace':
      return applyPace(value.target, value.args[0], begin, end, context);
    case 'round':
      return mapNumericPayload(targetEvents, Math.round);
    case 'rootNotes':
      return applyRootNotes(targetEvents, value.args[0]);
    case 'scale':
      return applyScale(targetEvents, value.args[0], begin, context);
    case 'scaleTranspose':
      return applyScaleTranspose(targetEvents, value.args[0], begin, context);
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
            const random = seededRandom(cycleSeed * 37 + index * 17 + hashString(context.channel));
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
        targetEvents,
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
      return applySet(targetEvents, value.args[0], begin, context);
    case 'transpose':
      return applyTranspose(targetEvents, value.args[0], begin, context);
    case 'voicing':
      return applyVoicing(targetEvents);
    default:
      if (PROPERTY_METHODS.has(value.name)) {
        return annotateEvents(targetEvents, value.name, value.args, context);
      }
      warnUnsupportedPattern('method', value.name);
      return targetEvents;
  }
}

function callPattern(
  property: 'chord' | 'n' | 'note' | 's' | 'sound' | 'value',
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
  property: 'chord' | 'n' | 'note' | 's' | 'sound' | 'value',
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

function applyRootNotes(
  currentEvents: PlaybackEvent[],
  octaveExpr: ExpressionValue | undefined,
): PlaybackEvent[] {
  const octave = resolveOctave(octaveExpr, 2);
  return currentEvents.map((event) => {
    const chordSymbol = resolveChordSymbol(event.payload);
    const root = chordSymbol ? renderChordRoot(chordSymbol, octave) : undefined;
    return root ? { ...event, payload: { ...event.payload, note: root } } : event;
  });
}

function applyScale(
  currentEvents: PlaybackEvent[],
  scaleExpr: ExpressionValue | undefined,
  begin: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const scaleName = resolvePropertyValue(scaleExpr, begin, context.cps);
  if (typeof scaleName !== 'string' || scaleName.trim() === '') {
    return currentEvents;
  }

  return currentEvents.map((event) => {
    const pitchKey = resolvePitchKey(event.payload);
    if (!pitchKey) {
      return event;
    }
    const scaled = scalePitchValue(event.payload[pitchKey], scaleName, event.payload.anchor);
    return scaled === undefined
      ? event
      : { ...event, payload: { ...event.payload, [pitchKey]: scaled, scale: scaleName } };
  });
}

function applyScaleTranspose(
  currentEvents: PlaybackEvent[],
  stepsExpr: ExpressionValue | undefined,
  begin: number,
  _context: InternalQueryContext,
): PlaybackEvent[] {
  const steps = evaluateNumericValue(stepsExpr, begin) ?? 0;
  return currentEvents.map((event) => {
    const scaleName = typeof event.payload.scale === 'string' ? event.payload.scale : undefined;
    const pitchKey = resolvePitchKey(event.payload);
    if (!scaleName || !pitchKey) {
      return event;
    }
    const shifted = transposePitchInScale(event.payload[pitchKey], scaleName, steps);
    return shifted === undefined ? event : { ...event, payload: { ...event.payload, [pitchKey]: shifted } };
  });
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

function applyTranspose(
  currentEvents: PlaybackEvent[],
  amountExpr: ExpressionValue | undefined,
  begin: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const amount = resolvePropertyValue(amountExpr, begin, context.cps);
  return currentEvents.map((event) => {
    const pitchKey = resolvePitchKey(event.payload);
    if (!pitchKey) {
      return event;
    }
    const shifted = transposePitch(event.payload[pitchKey], amount);
    return shifted === undefined ? event : { ...event, payload: { ...event.payload, [pitchKey]: shifted } };
  });
}

function applyVoicing(currentEvents: PlaybackEvent[]): PlaybackEvent[] {
  return currentEvents.flatMap((event) => {
    const chordSymbol = resolveChordSymbol(event.payload);
    if (!chordSymbol) {
      return [event];
    }

    const mode = typeof event.payload.mode === 'string' ? event.payload.mode : undefined;
    if (mode?.startsWith('root:')) {
      const anchorOctave = Note.get(mode.slice('root:'.length).trim()).oct ?? 2;
      const root = renderChordRoot(chordSymbol, anchorOctave);
      return root ? [{ ...event, payload: { ...event.payload, note: root } }] : [event];
    }

    const dictionary = typeof event.payload.dict === 'string' ? event.payload.dict : undefined;
    const notes = renderChordVoicing(chordSymbol, dictionary, event.payload.anchor, mode);
    if (notes.length === 0) {
      return [event];
    }

    const noteIndex = resolveVoicingIndex(event.payload);
    if (noteIndex !== undefined) {
      const note = noteAtIndex(notes, noteIndex);
      return note ? [{ ...event, payload: { ...event.payload, note } }] : [event];
    }

    return notes.map((note) => ({
      ...event,
      payload: { ...event.payload, note },
    }));
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
  if (!Number.isFinite(size) || size <= 0 || transformedPattern === undefined) {
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
  if (!Number.isFinite(segments) || segments <= 0) {
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
  const cycleCount = leastCommonMultiple(groups.map((group) => group.length));
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

  const rounds = leastCommonMultiple(normalized.map((entry) => entry.steps));
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
  const steps = leastCommonMultiple(normalized.map((entry) => entry.steps));
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
        const cycleCount = leastCommonMultiple(groups.map((group) => group.length));
        let total = 0;
        for (let index = 0; index < cycleCount; index += 1) {
          for (const group of groups) {
            total += inferStepCount(group[index % group.length], begin, context) ?? 1;
          }
        }
        return total;
      }
      case 'polymeter':
        return leastCommonMultiple(value.args.map((entry) => inferStepCount(entry, begin, context) ?? 1));
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

function leastCommonMultiple(values: number[]): number {
  const normalized = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.round(value))
    .filter((value) => value > 0);
  if (normalized.length === 0) {
    return 1;
  }
  return normalized.reduce((accumulator, value) => lcmIntegers(accumulator, value));
}

function lcmIntegers(left: number, right: number): number {
  return Math.abs(left * right) / gcdIntegers(left, right);
}

function gcdIntegers(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
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

function clipEvent(event: PlaybackEvent, begin: number, end: number): PlaybackEvent | undefined {
  const clippedBegin = Math.max(begin, event.begin);
  const clippedEnd = Math.min(end, event.end);
  if (clippedEnd <= clippedBegin) {
    return undefined;
  }

  return {
    ...event,
    begin: clippedBegin,
    duration: clippedEnd - clippedBegin,
    end: clippedEnd,
  };
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

function transformFast(
  target: ExpressionValue,
  begin: number,
  end: number,
  factor: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  if (!Number.isFinite(factor) || factor <= 0) {
    return queryPattern(target, begin, end, context);
  }
  const scaled = queryPattern(target, begin * factor, end * factor, context);
  return scaled.map((event) => ({
    ...event,
    begin: event.begin / factor,
    duration: event.duration / factor,
    end: event.end / factor,
  }));
}

function transformSlow(
  target: ExpressionValue,
  begin: number,
  end: number,
  factor: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  if (!Number.isFinite(factor) || factor <= 0) {
    return queryPattern(target, begin, end, context);
  }
  return queryPattern(target, begin / factor, end / factor, context).map((event) => ({
    ...event,
    begin: event.begin * factor,
    duration: event.duration * factor,
    end: event.end * factor,
  }));
}

function transformSlowGap(
  target: ExpressionValue,
  begin: number,
  end: number,
  factor: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  if (!Number.isFinite(factor) || factor <= 0) {
    return queryPattern(target, begin, end, context);
  }
  return transformFastGap(target, begin, end, 1 / factor, context);
}

function transformFastGap(
  target: ExpressionValue,
  begin: number,
  end: number,
  factor: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  if (!Number.isFinite(factor) || factor <= 0) {
    return queryPattern(target, begin, end, context);
  }
  if (factor < 1) {
    return transformSlow(target, begin, end, 1 / factor, context);
  }
  return remapCycleWindows(target, begin, end, context, 0, 1, 0, 1 / factor);
}

function queryRepeatedCycleWindow(
  target: ExpressionValue,
  sourceCycle: number,
  outputCycle: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  return shiftEvents(
    queryPattern(target, sourceCycle, sourceCycle + 1, context),
    outputCycle - sourceCycle,
    outputCycle,
    outputCycle + 1,
  );
}

function transformCompress(
  target: ExpressionValue,
  begin: number,
  end: number,
  windowBegin: number,
  windowEnd: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  if (!Number.isFinite(windowBegin) || !Number.isFinite(windowEnd) || windowBegin >= windowEnd) {
    return [];
  }
  if (windowBegin < 0 || windowEnd > 1) {
    return [];
  }
  return remapCycleWindows(target, begin, end, context, 0, 1, windowBegin, windowEnd);
}

function transformZoom(
  target: ExpressionValue,
  begin: number,
  end: number,
  windowBegin: number,
  windowEnd: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  if (!Number.isFinite(windowBegin) || !Number.isFinite(windowEnd) || windowBegin >= windowEnd) {
    return [];
  }
  const normalizedBegin = clampNumber(windowBegin, 0, 1, 0);
  const normalizedEnd = clampNumber(windowEnd, 0, 1, 1);
  if (normalizedBegin >= normalizedEnd) {
    return [];
  }
  return remapCycleWindows(target, begin, end, context, normalizedBegin, normalizedEnd, 0, 1);
}

function transformLinger(
  target: ExpressionValue,
  begin: number,
  end: number,
  amount: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  if (!Number.isFinite(amount) || amount === 0) {
    return [];
  }
  const magnitude = Math.abs(amount);
  if (magnitude >= 1) {
    return queryPattern(target, begin, end, context);
  }
  const zoomed = transformZoom(
    target,
    begin,
    end,
    amount < 0 ? 1 - magnitude : 0,
    amount < 0 ? 1 : magnitude,
    context,
  );
  return zoomed.flatMap((event) => repeatEventWithinCycle(event, magnitude, begin, end));
}

function transformRev(currentEvents: PlaybackEvent[], begin: number, end: number): PlaybackEvent[] {
  return currentEvents
    .map((event) => {
      const cycleStart = Math.floor(event.begin);
      const localBegin = event.begin - cycleStart;
      const localEnd = event.end - cycleStart;
      const reversedBegin = cycleStart + (1 - localEnd);
      const reversedEnd = cycleStart + (1 - localBegin);
      return {
        ...event,
        begin: reversedBegin,
        duration: reversedEnd - reversedBegin,
        end: reversedEnd,
      };
    })
    .filter((event) => event.end > begin && event.begin < end)
    .sort((left, right) => left.begin - right.begin || left.channel.localeCompare(right.channel));
}

function shiftEvents(
  currentEvents: PlaybackEvent[],
  amount: number,
  begin: number,
  end: number,
): PlaybackEvent[] {
  return currentEvents
    .map((event) => ({
      ...event,
      begin: event.begin + amount,
      end: event.end + amount,
    }))
    .filter((event) => event.end > begin && event.begin < end);
}

function remapCycleWindows(
  target: ExpressionValue,
  begin: number,
  end: number,
  context: InternalQueryContext,
  sourceBeginPhase: number,
  sourceEndPhase: number,
  destBeginPhase: number,
  destEndPhase: number,
): PlaybackEvent[] {
  const sourceWidth = sourceEndPhase - sourceBeginPhase;
  const destWidth = destEndPhase - destBeginPhase;
  if (sourceWidth <= 0 || destWidth <= 0) {
    return [];
  }
  const scale = destWidth / sourceWidth;
  const startCycle = Math.floor(begin);
  const endCycle = Math.ceil(end);
  const events: PlaybackEvent[] = [];

  for (let cycle = startCycle; cycle < endCycle; cycle += 1) {
    const sourceBegin = cycle + sourceBeginPhase;
    const sourceEnd = cycle + sourceEndPhase;
    const destBegin = cycle + destBeginPhase;
    const slotEvents = queryPattern(target, sourceBegin, sourceEnd, context).map((event) => ({
      ...event,
      begin: destBegin + (event.begin - sourceBegin) * scale,
      duration: (event.end - event.begin) * scale,
      end: destBegin + (event.end - sourceBegin) * scale,
    }));
    for (const event of slotEvents) {
      const clipped = clipEvent(event, begin, end);
      if (clipped) {
        events.push(clipped);
      }
    }
  }

  return events.sort((left, right) => left.begin - right.begin || left.channel.localeCompare(right.channel));
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

function repeatEventWithinCycle(
  event: PlaybackEvent,
  segmentSize: number,
  begin: number,
  end: number,
): PlaybackEvent[] {
  const cycle = Math.floor(event.begin);
  const repeats = Math.max(1, Math.ceil(1 / segmentSize));
  const localBegin = event.begin - cycle;
  const localEnd = event.end - cycle;
  const events: PlaybackEvent[] = [];

  for (let index = 0; index < repeats; index += 1) {
    const offset = index * segmentSize;
    const repeated = {
      ...event,
      begin: cycle + offset + localBegin * segmentSize,
      duration: (localEnd - localBegin) * segmentSize,
      end: cycle + offset + localEnd * segmentSize,
    };
    const clipped = clipEvent(repeated, begin, end);
    if (clipped) {
      events.push(clipped);
    }
  }

  return events;
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

function mapNumericPayload(
  currentEvents: PlaybackEvent[],
  mapper: (value: number) => number,
): PlaybackEvent[] {
  return currentEvents.map((event) => {
    const [key, value] = firstPayloadEntry(event.payload);
    if (!key || typeof value !== 'number') {
      return event;
    }
    return { ...event, payload: { ...event.payload, [key]: mapper(value) } };
  });
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
        duration: event.duration * clampNumber(resolvedValue, 0.05, 1, 1),
        payload,
      };
    }

    return { ...event, payload };
  });
}

function resolvePropertyValue(value: ExpressionValue | undefined, cycle: number, _cps: number): unknown {
  if (value === undefined) {
    return true;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  if (typeof value === 'string') {
    let numeric: number | undefined;
    try {
      numeric = evaluateMiniNumber(value, cycle);
    } catch {
      return value;
    }
    return numeric ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolvePropertyValue(entry, cycle, _cps));
  }

  if (!isExpressionNode(value)) {
    return value;
  }

  if (value.exprType === 'signal') {
    return evaluateSignalExpression(value, cycle);
  }

  return evaluatePatternValue(value, cycle) ?? value;
}

function coerceMiniValue(value: string): number | string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function resolvePitchKey(payload: Record<string, unknown>): 'n' | 'note' | 'value' | undefined {
  if (payload.note !== undefined) {
    return 'note';
  }
  if (payload.n !== undefined) {
    return 'n';
  }
  if (payload.value !== undefined) {
    return 'value';
  }
  return undefined;
}

function resolveOctave(value: ExpressionValue | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const numeric = Number(value.trim());
    if (Number.isFinite(numeric)) {
      return Math.trunc(numeric);
    }
  }
  return fallback;
}

function scalePitchValue(
  value: unknown,
  scaleName: string,
  anchorValue?: unknown,
): number | string | undefined {
  const anchorMidi = resolveAnchorMidi(anchorValue);
  if (anchorMidi !== undefined) {
    return scalePitchValueWithAnchor(value, scaleName, anchorMidi);
  }
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+[#b]*$/.test(value.trim()))) {
    return degreeToScaleNote(value, scaleName);
  }
  if (typeof value === 'string' && isScientificPitch(value)) {
    return quantizePitchToScale(value, scaleName);
  }
  return undefined;
}

function scalePitchValueWithAnchor(
  value: unknown,
  scaleName: string,
  anchorMidi: number,
): number | string | undefined {
  const parsed = typeof value === 'number' || typeof value === 'string' ? parseScaleDegree(value) : undefined;
  if (parsed) {
    return degreeToAnchoredScaleMidi(parsed, scaleName, anchorMidi);
  }
  if (typeof value === 'string' && isScientificPitch(value)) {
    return quantizePitchToScale(value, scaleName);
  }
  return undefined;
}

function transposePitchInScale(
  value: unknown,
  scaleName: string,
  steps: number,
): string | number | undefined {
  if (typeof value === 'number') {
    return value + steps;
  }
  if (typeof value === 'string' && /^-?\d+[#b]*$/.test(value.trim())) {
    const numeric = Number.parseInt(value.trim(), 10);
    return degreeToScaleNote(numeric + Math.trunc(steps), scaleName);
  }
  if (typeof value === 'string' && isScientificPitch(value)) {
    const midi = Note.midi(value);
    if (midi === null) {
      return undefined;
    }
    const scaleMidis = enumerateScaleMidis(scaleName, midi - 24, midi + 24);
    if (scaleMidis.length === 0) {
      return undefined;
    }
    const target = scaleMidis[nearestIndex(scaleMidis, midi) + Math.trunc(steps)];
    return target === undefined ? undefined : Note.fromMidiSharps(target);
  }
  return undefined;
}

function transposePitch(value: unknown, amount: unknown): string | number | undefined {
  if (typeof value === 'number') {
    const numeric = typeof amount === 'number' ? amount : Number(amount);
    return Number.isFinite(numeric) ? value + numeric : undefined;
  }
  if (typeof value === 'string' && isScientificPitch(value)) {
    if (typeof amount === 'string' && /[PMAmd]/.test(amount)) {
      return Note.transpose(value, amount);
    }
    const numeric = typeof amount === 'number' ? amount : Number(amount);
    return Number.isFinite(numeric) ? Note.transpose(value, Interval.fromSemitones(numeric)) : undefined;
  }
  return undefined;
}

function degreeToScaleNote(value: string | number, scaleName: string): string | undefined {
  const parsed = parseScaleDegree(value);
  const scale = resolveScale(scaleName);
  if (!parsed || scale.empty) {
    return undefined;
  }

  const tonic = ensureOctave(scale.tonic || 'C', 3);
  const index = positiveMod(parsed.step, scale.intervals.length);
  const interval = scale.intervals[index] ?? '1P';
  let note = Note.transpose(tonic, interval);

  const octaveShift = Math.floor(parsed.step / scale.intervals.length);
  if (octaveShift !== 0) {
    note = Note.transpose(note, Interval.fromSemitones(octaveShift * 12));
  }
  if (parsed.accidentalOffset !== 0) {
    note = Note.transpose(note, Interval.fromSemitones(parsed.accidentalOffset));
  }
  return note;
}

function degreeToAnchoredScaleMidi(
  parsed: { accidentalOffset: number; step: number },
  scaleName: string,
  anchorMidi: number,
): number | undefined {
  const scaleMidis = enumerateScaleMidis(scaleName, anchorMidi - 72, anchorMidi + 72);
  if (scaleMidis.length === 0) {
    return undefined;
  }

  const baseIndex = nearestScaleIndexBelowAnchor(scaleMidis, anchorMidi);
  const target = scaleMidis[baseIndex + parsed.step];
  return target === undefined ? undefined : target + parsed.accidentalOffset;
}

function quantizePitchToScale(note: string, scaleName: string): string | undefined {
  const midi = Note.midi(note);
  if (midi === null) {
    return undefined;
  }
  const scaleMidis = enumerateScaleMidis(scaleName, midi - 24, midi + 24);
  if (scaleMidis.length === 0) {
    return undefined;
  }
  const nearest = scaleMidis[nearestIndex(scaleMidis, midi)];
  return nearest === undefined ? undefined : Note.fromMidiSharps(nearest);
}

function resolveScale(scaleName: string) {
  return Scale.get(scaleName.replaceAll(':', ' ').trim());
}

function parseScaleDegree(value: string | number): { accidentalOffset: number; step: number } | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { accidentalOffset: 0, step: Math.trunc(value) };
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = /^(-?\d+)([#b]*)$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  return {
    accidentalOffset: [...(match[2] ?? '')].reduce(
      (sum, accidental) => sum + (accidental === '#' ? 1 : -1),
      0,
    ),
    step: Number(match[1]),
  };
}

function isScientificPitch(value: string): boolean {
  return Note.midi(value) !== null;
}

function enumerateScaleMidis(scaleName: string, minMidi: number, maxMidi: number): number[] {
  const scale = resolveScale(scaleName);
  if (scale.empty) {
    return [];
  }
  const values: number[] = [];
  for (let octave = -1; octave <= 9; octave += 1) {
    for (const note of scale.notes) {
      const midi = Note.midi(`${Note.get(note).pc || note}${octave}`);
      if (midi !== null && midi >= minMidi && midi <= maxMidi) {
        values.push(midi);
      }
    }
  }
  return values.sort((left, right) => left - right);
}

function nearestScaleIndexBelowAnchor(values: number[], anchorMidi: number): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if ((values[index] ?? Number.POSITIVE_INFINITY) <= anchorMidi) {
      return index;
    }
  }
  return 0;
}

function nearestIndex(values: number[], target: number): number {
  let bestIndex = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const delta = Math.abs((values[index] ?? target) - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function resolveChordSymbol(payload: Record<string, unknown>): string | undefined {
  const chord = payload.chord ?? payload.value;
  return typeof chord === 'string' && chord.trim() !== '' ? chord.trim() : undefined;
}

function renderChordRoot(chordSymbol: string, octave: number): string | undefined {
  const chord = Chord.get(chordSymbol);
  if (!chord.tonic) {
    return undefined;
  }
  return `${Note.get(chord.tonic).pc || chord.tonic}${octave}`;
}

function renderChordVoicing(
  chordSymbol: string,
  dictionary = 'ireal',
  anchorValue?: unknown,
  mode = 'below',
): string[] {
  const chord = Chord.get(chordSymbol);
  if (chord.empty || !chord.tonic) {
    return [];
  }

  const baseOctave = dictionary === 'lefthand' ? 3 : 4;
  const root = ensureOctave(chord.tonic, baseOctave);
  const notes = chord.intervals.map((interval) => Note.transpose(root, interval));
  if (notes.length === 0) {
    return [];
  }

  switch (dictionary) {
    case 'guidetones':
      return alignVoicingToAnchor(selectVoicingNotes(notes, [1, 3]), anchorValue, mode);
    case 'lefthand':
      return alignVoicingToAnchor(
        selectVoicingNotes(notes, [1, 3, 4, 5]).map((note) =>
          Note.transpose(note, Interval.fromSemitones(-12)),
        ),
        anchorValue,
        mode,
      );
    case 'triads':
      return alignVoicingToAnchor(selectVoicingNotes(notes, [0, 1, 2]), anchorValue, mode);
    default:
      return alignVoicingToAnchor(selectVoicingNotes(notes, [1, 3, 4, 2, 0]).slice(0, 4), anchorValue, mode);
  }
}

function alignVoicingToAnchor(notes: string[], anchorValue?: unknown, mode = 'below'): string[] {
  const anchorMidi = resolveAnchorMidi(anchorValue);
  if (anchorMidi === undefined || notes.length <= 1) {
    return notes;
  }

  const noteMidis = notes
    .map((note) => Note.midi(note))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  if (noteMidis.length !== notes.length) {
    return notes;
  }

  const candidates = buildVoicingCandidates(noteMidis);
  const selected =
    pickAnchoredVoicing(candidates, anchorMidi, mode) ??
    pickAnchoredVoicing(candidates, anchorMidi, 'below') ??
    candidates[0];
  return selected?.map((midi) => Note.fromMidiSharps(midi)).filter((note) => note.length > 0) ?? notes;
}

function buildVoicingCandidates(noteMidis: number[]): number[][] {
  const inversions = noteMidis.map((_, rotationIndex) => {
    const rotated = noteMidis.slice(rotationIndex).concat(noteMidis.slice(0, rotationIndex));
    const inversion: number[] = [];
    let floor = Number.NEGATIVE_INFINITY;
    for (const midi of rotated) {
      let current = midi;
      while (current <= floor) {
        current += 12;
      }
      inversion.push(current);
      floor = current;
    }
    return inversion;
  });

  const candidates: number[][] = [];
  for (const inversion of inversions) {
    for (let octaveShift = -3; octaveShift <= 3; octaveShift += 1) {
      candidates.push(inversion.map((midi) => midi + octaveShift * 12));
    }
  }
  return candidates;
}

function pickAnchoredVoicing(candidates: number[][], anchorMidi: number, mode: string): number[] | undefined {
  const normalizedMode = mode === 'above' || mode === 'duck' ? mode : 'below';
  const scored = candidates
    .map((candidate) => ({
      candidate,
      max: candidate[candidate.length - 1] ?? Number.NEGATIVE_INFINITY,
      min: candidate[0] ?? Number.POSITIVE_INFINITY,
    }))
    .filter(({ max, min }) => {
      switch (normalizedMode) {
        case 'above':
          return min >= anchorMidi;
        case 'duck':
          return max < anchorMidi;
        default:
          return max <= anchorMidi;
      }
    })
    .sort((left, right) => {
      const leftDistance =
        normalizedMode === 'above' ? left.min - anchorMidi : Math.abs(anchorMidi - left.max);
      const rightDistance =
        normalizedMode === 'above' ? right.min - anchorMidi : Math.abs(anchorMidi - right.max);
      return leftDistance - rightDistance || left.max - right.max || left.min - right.min;
    });

  return scored[0]?.candidate;
}

function resolveAnchorMidi(anchorValue: unknown): number | undefined {
  if (typeof anchorValue === 'number' && Number.isFinite(anchorValue)) {
    return Math.round(anchorValue);
  }
  if (typeof anchorValue !== 'string') {
    return undefined;
  }
  const trimmed = anchorValue.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return Math.round(numeric);
  }
  const midi = Note.midi(trimmed);
  return midi === null ? undefined : midi;
}

function selectVoicingNotes(notes: string[], preferredIndices: number[]): string[] {
  const selected: string[] = [];
  for (const index of preferredIndices) {
    const note = notes[index];
    if (note && !selected.includes(note)) {
      selected.push(note);
    }
  }
  return selected.length > 0 ? selected : notes;
}

function resolveVoicingIndex(payload: Record<string, unknown>): number | undefined {
  const value = payload.n ?? (typeof payload.note === 'number' ? payload.note : undefined);
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function noteAtIndex(notes: string[], index: number): string | undefined {
  if (notes.length === 0) {
    return undefined;
  }
  const wrapped = positiveMod(index, notes.length);
  const octaveShift = Math.floor(index / notes.length);
  const selected = notes[wrapped];
  return selected === undefined
    ? undefined
    : octaveShift === 0
      ? selected
      : Note.transpose(selected, Interval.fromSemitones(octaveShift * 12));
}

function ensureOctave(note: string, octave: number): string {
  const parsed = Note.get(note);
  return `${parsed.pc || note}${parsed.oct ?? octave}`;
}

function evaluateMiniNumber(source: string, cycle: number): number | undefined {
  const hits = queryMini(source, cycle, cycle + Number.EPSILON * 10).find(
    (event) => event.begin <= cycle && event.end > cycle,
  );
  if (!hits) {
    return undefined;
  }
  const numeric = Number(hits.value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

function evaluatePatternValue(value: ExpressionValue, cycle: number): unknown {
  const events = queryPattern(value, cycle, cycle + Number.EPSILON * 10, { channel: '$value', cps: 1 });
  const hit = events.find((event) => event.begin <= cycle && event.end > cycle) ?? events[0];
  return hit ? extractEventValue(hit.payload) : undefined;
}

function queryValueEvents(
  value: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
): MiniEventLike[] {
  if (value === undefined) {
    return [];
  }

  if (typeof value === 'string') {
    return queryMini(value, begin, end);
  }

  const events = queryPattern(value, begin, end, { ...context, channel: `${context.channel}:value` });
  return events.map((event) => ({
    begin: event.begin,
    end: event.end,
    value: extractEventValue(event.payload),
  }));
}

function extractEventValue(payload: Record<string, unknown>): unknown {
  if ('value' in payload) {
    return payload.value;
  }

  const firstKey = Object.keys(payload)[0];
  return firstKey ? payload[firstKey] : undefined;
}

function firstPayloadEntry(payload: Record<string, unknown>): [string | undefined, unknown] {
  const firstKey = Object.keys(payload)[0];
  return [firstKey, firstKey ? payload[firstKey] : undefined];
}

function isTruthyMaskValue(value: unknown): boolean {
  if (value === undefined || value === null || value === false) {
    return false;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    return !['', '0', 'false', '~'].includes(value);
  }

  return true;
}

interface MiniEventLike {
  begin: number;
  end: number;
  value: unknown;
}

function evaluateSignalExpression(expr: ExpressionNode, cycle: number): number {
  if (expr.kind === 'call') {
    switch (expr.name) {
      case 'input':
        return coerceSignalNumber(
          getInputValue(
            resolveInputKey(`${expr.args[0] ?? 'input:default'}`),
            resolveSignalFallback(expr.args[1]),
          ),
        );
      case 'midi':
      case 'cc':
        return coerceSignalNumber(
          getInputValue(
            resolveMidiInputKey(`${expr.args[0] ?? '0'}`, `${expr.args[1] ?? 'default'}`),
            resolveSignalFallback(expr.args[2] ?? expr.args[1]),
          ),
        );
      case 'gamepad':
        return coerceSignalNumber(
          getInputValue(
            resolveGamepadInputKey(`${expr.args[0] ?? 'axis:0'}`, evaluateSignalValue(expr.args[1], cycle)),
            resolveSignalFallback(expr.args[2] ?? expr.args[1]),
          ),
        );
      case 'motion':
        return coerceSignalNumber(
          getInputValue(resolveMotionInputKey(`${expr.args[0] ?? 'x'}`), resolveSignalFallback(expr.args[1])),
        );
      case 'cosine':
        return 0.5 + 0.5 * Math.cos(Math.PI * 2 * cycle);
      case 'sine':
        return 0.5 + 0.5 * Math.sin(Math.PI * 2 * cycle);
      case 'saw':
        return cycle - Math.floor(cycle);
      case 'tri':
      case 'triangle': {
        const phase = cycle - Math.floor(cycle);
        return phase < 0.5 ? phase * 2 : 2 - phase * 2;
      }
      case 'square':
        return cycle - Math.floor(cycle) < 0.5 ? 0 : 1;
      case 'rand':
        return seededRandom(Math.floor(cycle * 64));
      case 'perlin':
        return smoothNoise(cycle);
      default:
        return 0;
    }
  }

  const target = evaluateSignalValue(expr.target, cycle);
  switch (expr.name) {
    case 'range': {
      const min = evaluateSignalValue(expr.args[0], cycle);
      const max = evaluateSignalValue(expr.args[1], cycle);
      return min + (max - min) * target;
    }
    case 'segment': {
      const segments = Math.max(1, Math.floor(evaluateSignalValue(expr.args[0], cycle) || 1));
      const snappedCycle = Math.floor(cycle * segments) / segments;
      return evaluateSignalValue(expr.target, snappedCycle);
    }
    case 'fast':
      return evaluateSignalValue(expr.target, cycle * evaluateSignalValue(expr.args[0], cycle));
    case 'slow':
      return evaluateSignalValue(expr.target, cycle / evaluateSignalValue(expr.args[0], cycle));
    case 'early':
      return evaluateSignalValue(expr.target, cycle + evaluateSignalValue(expr.args[0], cycle));
    case 'late':
      return evaluateSignalValue(expr.target, cycle - evaluateSignalValue(expr.args[0], cycle));
    case 'add':
      return target + evaluateSignalValue(expr.args[0], cycle);
    case 'sub':
      return target - evaluateSignalValue(expr.args[0], cycle);
    case 'mul':
      return target * evaluateSignalValue(expr.args[0], cycle);
    case 'div':
      return target / Math.max(1e-9, evaluateSignalValue(expr.args[0], cycle));
    default:
      return target;
  }
}

function evaluateSignalValue(value: ExpressionValue | undefined, cycle: number): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return evaluateMiniNumber(value, cycle) ?? 0;
  }

  if (isExpressionNode(value)) {
    return evaluateSignalExpression(value, cycle);
  }

  return 0;
}

function resolveSignalFallback(value: ExpressionValue | undefined): number {
  return coerceSignalNumber(resolvePropertyValue(value, 0, 1));
}

function coerceSignalNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'string') {
    const numeric = Number(value.trim());
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return 0;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function hashEvent(event: PlaybackEvent): number {
  return (
    Math.floor(event.begin * 10_000) ^
    Math.floor(event.end * 10_000) ^
    hashString(event.channel) ^
    hashString(JSON.stringify(event.payload))
  );
}

function shuffledIndices(count: number, seed: number): number[] {
  const indices = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index > 0; index -= 1) {
    const random = seededRandom(seed * 53 + index * 97);
    const swapIndex = Math.floor(random * (index + 1));
    const current = indices[index];
    indices[index] = indices[swapIndex] ?? 0;
    indices[swapIndex] = current ?? 0;
  }
  return indices;
}

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function normalizeCyclePhase(value: number): number {
  return positiveMod(value, 1);
}

function normalizeWeightedEntry(
  value: ExpressionValue,
): { value: ExpressionValue; weight: number } | undefined {
  if (Array.isArray(value)) {
    const [entry, weightRaw] = value;
    const weight =
      typeof weightRaw === 'number'
        ? weightRaw
        : typeof weightRaw === 'string'
          ? Number(weightRaw)
          : Number.NaN;
    if (entry !== undefined && Number.isFinite(weight)) {
      return { value: entry, weight };
    }
  }
  return { value, weight: 1 };
}

function smoothNoise(value: number): number {
  const floor = Math.floor(value);
  const t = value - floor;
  const left = seededRandom(floor);
  const right = seededRandom(floor + 1);
  return left + (right - left) * (t * t * (3 - 2 * t));
}

export class Scheduler {
  private clearIntervalFn: typeof clearInterval;
  private cycleAtCpsChange = 0;
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private lastBegin = 0;
  private lastEnd = 0;
  private lastTick = 0;
  private numTicksSinceCpsChange = 0;
  private scene: SceneSpec | undefined;
  private secondsAtCpsChange = 0;
  private setIntervalFn: typeof setInterval;
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
      this.options.getTime() - this.lastTick - (this.options.windowDuration ?? 0.05);
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
    const transportCps = evaluateNumericValue(scene.transport.cps ?? scene.transport.bpm, this.now());
    if (transportCps !== undefined) {
      this.setCps(scene.transport.bpm ? transportCps / 60 : transportCps);
    }
  }

  start(): void {
    if (this.started) {
      return;
    }
    if (!this.scene) {
      throw new Error('Scheduler requires a scene before start');
    }
    this.started = true;
    this.tick();
    this.intervalHandle = this.setIntervalFn(this.tick, (this.options.interval ?? 0.1) * 1000);
  }

  stop(): void {
    if (this.intervalHandle) {
      this.clearIntervalFn(this.intervalHandle);
    }
    this.intervalHandle = undefined;
    this.started = false;
    this.lastBegin = 0;
    this.lastEnd = 0;
    this.lastTick = 0;
    this.numTicksSinceCpsChange = 0;
  }

  private tick = (): void => {
    if (!this.scene || !this.started) {
      return;
    }

    const getTime = this.options.getTime;
    const duration = this.options.windowDuration ?? 0.05;
    const interval = this.options.interval ?? 0.1;
    const overlap = this.options.overlap ?? 0.1;
    const latency = this.options.latency ?? 0.1;
    const now = getTime();
    const lookahead = now + interval + overlap;
    let phase = this.lastTick === 0 ? now + 0.01 : this.lastTick + duration;

    while (phase < lookahead) {
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

      const transportCps = evaluateNumericValue(this.scene.transport.cps, begin);
      if (transportCps !== undefined && transportCps !== this.cps) {
        this.setCps(transportCps);
      }

      const events = queryScene(this.scene, begin, end, { cps: this.cps });
      for (const event of events) {
        const rawTargetTime =
          (event.begin - this.cycleAtCpsChange) / this.cps + this.secondsAtCpsChange + latency;
        const targetTime = Math.max(rawTargetTime, now + 0.001);
        for (const dispatch of collectExternalDispatches(event, targetTime)) {
          void this.options.onExternalDispatch?.(dispatch, targetTime);
        }
        void this.options.onTrigger(event, targetTime);
      }

      phase += duration;
    }
  };
}
