import { type ExpressionNode, type ExpressionValue, isExpressionNode, isPlainObject } from '@tussel/ir';
import { inferMiniSteps, queryMini } from '@tussel/mini';
import { annotateEvents } from './conditionals.js';
import {
  coerceMiniValue,
  evaluateNumericValue,
  firstPayloadEntry,
  isTruthyMaskValue,
  queryValueEvents,
  resolvePropertyValue,
} from './evaluate.js';
import { type InternalQueryContext, queryPattern } from './index.js';
import { evaluateSignalExpression } from './signals.js';
import {
  clipEvent,
  queryRepeatedCycleWindow,
  remapCycleWindows,
  transformCompress,
  transformFast,
  transformZoom,
} from './time-transforms.js';
import type { PlaybackEvent } from './types.js';
import {
  clampNumber,
  hashEvent,
  hashString,
  leastCommonMultiple,
  normalizeWeightedEntry,
  positiveMod,
  seededRandom,
  shuffledIndices,
  smoothNoise,
} from './utils.js';

export function callPattern(
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

export function remapEventPayload(
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

export function applySet(
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

export function applyPace(
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

export function applyExpand(
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

export function applyContract(
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

export function applyExtend(
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

export function applyTake(
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

export function applyDrop(
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

export function applyTakeScalar(
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

export function applyDropScalar(
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

export function applyShrink(
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

export function applyGrow(
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

export function buildShrinkSegments(
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

export function buildGrowSegments(
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

export function applyTour(
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

export function applyChunk(
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

export function applySegment(
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

export function applyStepwiseFactorTransform(
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

export function queryStepcat(
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

export function queryStepcatEntry(
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

export function queryPatternWithinCycleWindow(
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

export function transformFastWithinCycleWindow(
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

export function queryStepalt(
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

export function queryZip(
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

export function queryPolymeter(
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

export function queryPatternStepSlice(
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

export function queryStepSegments(
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

export function normalizeStepcatEntry(
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

export function inferStepCount(
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

export function resolveStepwiseNumberList(
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

export function resolveTakeSteps(currentSteps: number, amount: number): number {
  if (currentSteps <= 0 || amount === 0) {
    return 0;
  }
  return Math.min(currentSteps, Math.abs(amount));
}

export function resolveDropSteps(currentSteps: number, amount: number): number {
  if (amount < 0) {
    return resolveTakeSteps(currentSteps, currentSteps + amount);
  }
  return resolveTakeSteps(currentSteps, currentSteps - amount);
}

export function clampStepCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function computeLcm(values: number[]): number {
  const normalized = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.round(value))
    .filter((value) => value > 0);
  if (normalized.length === 0) {
    return 1;
  }
  return normalized.reduce((accumulator, value) => leastCommonMultiple(accumulator, value));
}

export function queryCat(
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

export function querySequence(
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

export function queryChoose(
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

export function queryCatEntry(
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

export function isAtomicMiniToken(value: string): boolean {
  return value.trim().length > 0 && !/[\s,[\]<>*/!@]/.test(value);
}

export function excludeEventWindow(
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

export function literalEvents(
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

export function rearrangeSlices(
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

export function applyMask(
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

export function applyPly(currentEvents: PlaybackEvent[], count: number): PlaybackEvent[] {
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

export function applyDegrade(currentEvents: PlaybackEvent[], amount: number): PlaybackEvent[] {
  const probability = clampNumber(amount, 0, 1, 0.5);
  return currentEvents.filter((event) => seededRandom(hashEvent(event)) >= probability);
}

export function applyNumericOperation(
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

export function applyOffset(currentEvents: PlaybackEvent[], amount: number): PlaybackEvent[] {
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
