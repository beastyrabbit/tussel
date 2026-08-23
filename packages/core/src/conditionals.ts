import type { ExpressionValue } from '@tussel/ir';
import {
  evaluateNumericValue,
  extractEventValue,
  isTruthyMaskValue,
  queryValueEvents,
  resolvePropertyValue,
} from './evaluate.js';
import { type InternalQueryContext, queryPattern } from './index.js';
import { shiftEvents, transformFast, transformSlow, transformZoom } from './time-transforms.js';
import type { PlaybackEvent } from './types.js';
import { clampNumber, hashString, normalizeCyclePhase, positiveMod, seededRandom } from './utils.js';

/** Minimum ratio for clip scaling (mirrors core default). */
export const MIN_CLIP_RATIO = 0.05;

export function applyEvery(
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

export function applyWhenMod(
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

export function applyLegato(
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

export function applyStut(
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

export function applySpin(
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

export function applyStriate(
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

export function applySpread(
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

export function applyFit(
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

export function applyBite(
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

export function applyWhen(
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

export function applySometimesBy(
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

export function applyWithin(
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

export function replaceEventsByWindow(
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

export function annotateEvents(
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
