import type { ExpressionValue } from '@tussel/ir';
import { evaluateNumericValue, firstPayloadEntry } from './evaluate.js';
import { type InternalQueryContext, queryPattern } from './index.js';
import type { PlaybackEvent } from './types.js';
import { clampNumber, normalizeCyclePhase, positiveMod } from './utils.js';

export function transformFast(
  target: ExpressionValue,
  begin: number,
  end: number,
  factor: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  if (!Number.isFinite(factor) || factor <= 0) {
    return [];
  }
  const scaled = queryPattern(target, begin * factor, end * factor, context);
  return scaled.map((event) => ({
    ...event,
    begin: event.begin / factor,
    duration: event.duration / factor,
    end: event.end / factor,
  }));
}

export function transformSlow(
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

export function transformSlowGap(
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

export function transformFastGap(
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

export function queryRepeatedCycleWindow(
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

export function transformCompress(
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

export function transformZoom(
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

export function transformLinger(
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

export function transformRev(currentEvents: PlaybackEvent[], begin: number, end: number): PlaybackEvent[] {
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

export function transformPalindrome(
  target: ExpressionValue,
  currentEvents: PlaybackEvent[],
  begin: number,
  end: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  // palindrome = lastOf(2, rev) — reverse every other (odd) cycle
  const startCycle = Math.floor(begin);
  const endCycle = Math.ceil(end);
  const events: PlaybackEvent[] = [];

  for (let cycle = startCycle; cycle < endCycle; cycle += 1) {
    const windowBegin = Math.max(begin, cycle);
    const windowEnd = Math.min(end, cycle + 1);
    if (windowBegin >= windowEnd) continue;

    if (positiveMod(cycle, 2) === 1) {
      // Odd cycle: reverse
      const cycleEvents = queryPattern(target, windowBegin, windowEnd, context);
      events.push(...transformRev(cycleEvents, windowBegin, windowEnd));
    } else {
      // Even cycle: normal — use events from currentEvents that fall in this window
      events.push(...currentEvents.filter((e) => e.begin >= windowBegin && e.begin < windowEnd));
    }
  }

  return events.sort((left, right) => left.begin - right.begin || left.channel.localeCompare(right.channel));
}

export function transformIter(
  target: ExpressionValue,
  begin: number,
  end: number,
  times: number,
  back: boolean,
  context: InternalQueryContext,
): PlaybackEvent[] {
  // iter(n) = slowcat of n rotations via early(i/n)
  // iterBack(n) = same but using late(i/n) instead
  const startCycle = Math.floor(begin);
  const endCycle = Math.ceil(end);
  const events: PlaybackEvent[] = [];

  for (let cycle = startCycle; cycle < endCycle; cycle += 1) {
    const windowBegin = Math.max(begin, cycle);
    const windowEnd = Math.min(end, cycle + 1);
    if (windowBegin >= windowEnd) continue;

    const rotationIndex = positiveMod(cycle, times);
    const offset = rotationIndex / times;

    if (back) {
      // iterBack: use late(i/n)
      const shifted = shiftEvents(
        queryPattern(target, windowBegin - offset, windowEnd - offset, context),
        offset,
        windowBegin,
        windowEnd,
      );
      events.push(...shifted);
    } else {
      // iter: use early(i/n)
      const shifted = shiftEvents(
        queryPattern(target, windowBegin + offset, windowEnd + offset, context),
        -offset,
        windowBegin,
        windowEnd,
      );
      events.push(...shifted);
    }
  }

  return events.sort((left, right) => left.begin - right.begin || left.channel.localeCompare(right.channel));
}

export function transformInside(
  target: ExpressionValue,
  begin: number,
  end: number,
  factor: number,
  transformExpr: ExpressionValue | undefined,
  context: InternalQueryContext,
): PlaybackEvent[] {
  // inside(n, f) = pat.slow(n).f().fast(n)
  // We slow the target, apply the transform, then fast the result
  if (!Number.isFinite(factor) || factor <= 0 || !transformExpr) {
    return queryPattern(target, begin, end, context);
  }
  // Query the slowed pattern with the transform applied, then speed it up
  const slowedAndTransformed = queryPattern(transformExpr, begin / factor, end / factor, context);
  return slowedAndTransformed.map((event) => ({
    ...event,
    begin: event.begin * factor,
    duration: event.duration * factor,
    end: event.end * factor,
  }));
}

export function transformOutside(
  target: ExpressionValue,
  begin: number,
  end: number,
  factor: number,
  transformExpr: ExpressionValue | undefined,
  context: InternalQueryContext,
): PlaybackEvent[] {
  // outside(n, f) = pat.fast(n).f().slow(n)
  // We fast the target, apply the transform, then slow the result
  if (!Number.isFinite(factor) || factor <= 0 || !transformExpr) {
    return queryPattern(target, begin, end, context);
  }
  // Query the fasted pattern with the transform applied, then slow it
  const fastedAndTransformed = queryPattern(transformExpr, begin * factor, end * factor, context);
  return fastedAndTransformed.map((event) => ({
    ...event,
    begin: event.begin / factor,
    duration: event.duration / factor,
    end: event.end / factor,
  }));
}

export function transformRibbon(
  target: ExpressionValue,
  begin: number,
  end: number,
  offset: number,
  cycles: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  // ribbon(offset, cycles) = pat.early(offset) then loop every `cycles` cycles
  if (!Number.isFinite(offset) || !Number.isFinite(cycles) || cycles <= 0) {
    return queryPattern(target, begin, end, context);
  }
  const startCycle = Math.floor(begin);
  const endCycle = Math.ceil(end);
  const events: PlaybackEvent[] = [];
  const loopLen = cycles;

  for (let cycle = startCycle; cycle < endCycle; cycle += 1) {
    const windowBegin = Math.max(begin, cycle);
    const windowEnd = Math.min(end, cycle + 1);
    if (windowBegin >= windowEnd) continue;

    // Map current cycle into the source window [offset, offset + cycles) with wrapping
    const sourceCycle = offset + positiveMod(cycle, loopLen);
    const sourceEvents = queryPattern(target, sourceCycle, sourceCycle + 1, context);
    const shifted = sourceEvents.map((event) => ({
      ...event,
      begin: cycle + (event.begin - sourceCycle),
      end: cycle + (event.end - sourceCycle),
      duration: event.duration,
    }));
    for (const event of shifted) {
      const clipped = clipEvent(event, windowBegin, windowEnd);
      if (clipped) events.push(clipped);
    }
  }

  return events.sort((left, right) => left.begin - right.begin || left.channel.localeCompare(right.channel));
}

export function transformSwingBy(
  target: ExpressionValue,
  begin: number,
  end: number,
  amount: number,
  subdivisions: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  // swingBy(amount, n) = inside(n, late(seq(0, amount/2)))
  // Delays the second half of each subdivision by amount/2
  if (!Number.isFinite(amount) || amount === 0 || subdivisions < 1) {
    return queryPattern(target, begin, end, context);
  }
  const events = queryPattern(target, begin, end, context);
  const halfDelay = amount / 2;

  return events
    .map((event) => {
      // Determine which subdivision this event falls in
      const cycleStart = Math.floor(event.begin);
      const localPos = event.begin - cycleStart;
      const slotWidth = 1 / subdivisions;
      const slotIndex = Math.floor(localPos / slotWidth);
      const posInSlot = (localPos - slotIndex * slotWidth) / slotWidth;

      // If event is in the second half of its slot, delay it
      if (posInSlot >= 0.5) {
        const delay = halfDelay * slotWidth;
        return {
          ...event,
          begin: event.begin + delay,
          end: event.end + delay,
        };
      }
      return event;
    })
    .filter((event) => event.end > begin && event.begin < end)
    .sort((left, right) => left.begin - right.begin || left.channel.localeCompare(right.channel));
}

export function generateBjorklundPattern(pulses: number, steps: number): boolean[] {
  if (pulses <= 0 || steps <= 0) return Array(steps).fill(false);
  if (pulses >= steps) return Array(steps).fill(true);

  // Bjorklund/Euclidean algorithm
  let pattern: boolean[][] = [
    ...Array.from({ length: pulses }, () => [true]),
    ...Array.from({ length: steps - pulses }, () => [false]),
  ];

  while (true) {
    const trueGroups = pattern.filter((g) => g[0] === true);
    const falseGroups = pattern.filter((g) => g[0] === false);
    if (falseGroups.length <= 1) break;

    const minLen = Math.min(trueGroups.length, falseGroups.length);
    const merged: boolean[][] = [];
    for (let i = 0; i < minLen; i++) {
      merged.push([...(trueGroups[i] ?? []), ...(falseGroups[i] ?? [])]);
    }
    const remainder =
      trueGroups.length > falseGroups.length ? trueGroups.slice(minLen) : falseGroups.slice(minLen);
    pattern = [...merged, ...remainder];
  }

  return pattern.flat();
}

export function applyEuclidRot(
  target: ExpressionValue,
  begin: number,
  end: number,
  pulses: number,
  steps: number,
  rotation: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  if (pulses <= 0) return [];
  const rhythm = generateBjorklundPattern(pulses, steps);
  const rot = ((rotation % steps) + steps) % steps;
  const rotated = [...rhythm.slice(rot), ...rhythm.slice(0, rot)];

  // Subdivide the target into `steps` segments per cycle, then keep only pulse positions
  const subdivided = transformFast(target, begin, end, steps, context);
  return applyEuclideanMask(subdivided, rotated, begin, end);
}

export function applyEuclidLegato(
  target: ExpressionValue,
  begin: number,
  end: number,
  pulses: number,
  steps: number,
  rotation: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  if (pulses <= 0) return [];
  const rhythm = generateBjorklundPattern(pulses, steps);
  const rot = ((rotation % steps) + steps) % steps;
  const rotated = [...rhythm.slice(rot), ...rhythm.slice(0, rot)];

  // Find onset positions and compute hold durations
  const onsetPositions: number[] = [];
  for (let i = 0; i < rotated.length; i++) {
    if (rotated[i]) onsetPositions.push(i);
  }
  if (onsetPositions.length === 0) return [];

  // Subdivide the target into `steps` segments per cycle
  const subdivided = transformFast(target, begin, end, steps, context);

  const startCycle = Math.floor(begin);
  const endCycle = Math.ceil(end);
  const events: PlaybackEvent[] = [];
  const stepWidth = 1 / steps;

  for (let cycle = startCycle; cycle < endCycle; cycle++) {
    const cycleSubdivided = subdivided.filter((e) => e.begin >= cycle && e.begin < cycle + 1);

    for (let oi = 0; oi < onsetPositions.length; oi++) {
      const onsetStep = onsetPositions[oi] ?? 0;
      const nextOnsetStep =
        oi + 1 < onsetPositions.length ? (onsetPositions[oi + 1] ?? 0) : (onsetPositions[0] ?? 0) + steps;
      const legatoBegin = cycle + onsetStep * stepWidth;
      const legatoEnd = cycle + nextOnsetStep * stepWidth;

      // Find the subdivided event at this onset step
      const matchingEvent =
        cycleSubdivided.find((e) => Math.abs(e.begin - legatoBegin) < stepWidth * 0.5) ?? cycleSubdivided[0];

      if (matchingEvent) {
        const ev = {
          ...matchingEvent,
          begin: legatoBegin,
          end: legatoEnd,
          duration: legatoEnd - legatoBegin,
        };
        const clipped = clipEvent(ev, begin, end);
        if (clipped) events.push(clipped);
      }
    }
  }

  return events.sort((left, right) => left.begin - right.begin || left.channel.localeCompare(right.channel));
}

export function applyEuclideanMask(
  currentEvents: PlaybackEvent[],
  rhythm: boolean[],
  _begin: number,
  _end: number,
): PlaybackEvent[] {
  const steps = rhythm.length;
  if (steps === 0) return [];
  const stepWidth = 1 / steps;

  return currentEvents.filter((event) => {
    const cycleStart = Math.floor(event.begin);
    const localPos = event.begin - cycleStart;
    const stepIndex = Math.min(steps - 1, Math.floor(localPos / stepWidth));
    return rhythm[stepIndex];
  });
}

export function applyAlignedOperation(
  leftTarget: ExpressionValue,
  rightTarget: ExpressionValue | undefined,
  begin: number,
  end: number,
  context: InternalQueryContext,
  operator: (left: number, right: number) => number,
  mode: AlignmentMode,
): PlaybackEvent[] {
  if (rightTarget === undefined) {
    return queryPattern(leftTarget, begin, end, context);
  }

  switch (mode) {
    case 'in':
      return alignIn(leftTarget, rightTarget, begin, end, context, operator);
    case 'out':
      return alignOut(leftTarget, rightTarget, begin, end, context, operator);
    case 'mix':
      return alignMix(leftTarget, rightTarget, begin, end, context, operator);
    case 'squeeze':
      return alignSqueeze(leftTarget, rightTarget, begin, end, context, operator);
    case 'squeezeout':
      return alignSqueeze(rightTarget, leftTarget, begin, end, context, (a, b) => operator(b, a));
    case 'reset':
      return alignReset(leftTarget, rightTarget, begin, end, context, operator, false);
    case 'restart':
      return alignReset(leftTarget, rightTarget, begin, end, context, operator, true);
    default:
      return queryPattern(leftTarget, begin, end, context);
  }
}

export function alignIn(
  leftTarget: ExpressionValue,
  rightTarget: ExpressionValue,
  begin: number,
  end: number,
  context: InternalQueryContext,
  operator: (left: number, right: number) => number,
): PlaybackEvent[] {
  // LEFT controls structure. For each left event, query right at left's span.
  const leftEvents = queryPattern(leftTarget, begin, end, context);
  const events: PlaybackEvent[] = [];

  for (const leftEvent of leftEvents) {
    const rightEvents = queryPattern(rightTarget, leftEvent.begin, leftEvent.end, context);
    for (const rightEvent of rightEvents) {
      const overlapBegin = Math.max(leftEvent.begin, rightEvent.begin);
      const overlapEnd = Math.min(leftEvent.end, rightEvent.end);
      if (overlapEnd <= overlapBegin) continue;

      const combined = combineEventValues(leftEvent, rightEvent, operator);
      events.push({
        ...combined,
        begin: overlapBegin,
        end: overlapEnd,
        duration: overlapEnd - overlapBegin,
      });
    }
  }

  return events.sort((a, b) => a.begin - b.begin || a.channel.localeCompare(b.channel));
}

export function alignOut(
  leftTarget: ExpressionValue,
  rightTarget: ExpressionValue,
  begin: number,
  end: number,
  context: InternalQueryContext,
  operator: (left: number, right: number) => number,
): PlaybackEvent[] {
  // RIGHT controls structure. For each right event, query left at right's span.
  const rightEvents = queryPattern(rightTarget, begin, end, context);
  const events: PlaybackEvent[] = [];

  for (const rightEvent of rightEvents) {
    const leftEvents = queryPattern(leftTarget, rightEvent.begin, rightEvent.end, context);
    for (const leftEvent of leftEvents) {
      const overlapBegin = Math.max(leftEvent.begin, rightEvent.begin);
      const overlapEnd = Math.min(leftEvent.end, rightEvent.end);
      if (overlapEnd <= overlapBegin) continue;

      const combined = combineEventValues(leftEvent, rightEvent, operator);
      events.push({
        ...combined,
        begin: overlapBegin,
        end: overlapEnd,
        duration: overlapEnd - overlapBegin,
      });
    }
  }

  return events.sort((a, b) => a.begin - b.begin || a.channel.localeCompare(b.channel));
}

export function alignMix(
  leftTarget: ExpressionValue,
  rightTarget: ExpressionValue,
  begin: number,
  end: number,
  context: InternalQueryContext,
  operator: (left: number, right: number) => number,
): PlaybackEvent[] {
  // Cross-product: both patterns queried at full window, only overlapping events combine.
  const leftEvents = queryPattern(leftTarget, begin, end, context);
  const rightEvents = queryPattern(rightTarget, begin, end, context);
  const events: PlaybackEvent[] = [];

  for (const leftEvent of leftEvents) {
    for (const rightEvent of rightEvents) {
      const overlapBegin = Math.max(leftEvent.begin, rightEvent.begin);
      const overlapEnd = Math.min(leftEvent.end, rightEvent.end);
      if (overlapEnd <= overlapBegin) continue;

      const combined = combineEventValues(leftEvent, rightEvent, operator);
      events.push({
        ...combined,
        begin: overlapBegin,
        end: overlapEnd,
        duration: overlapEnd - overlapBegin,
      });
    }
  }

  return events.sort((a, b) => a.begin - b.begin || a.channel.localeCompare(b.channel));
}

export function alignSqueeze(
  outerTarget: ExpressionValue,
  innerTarget: ExpressionValue,
  begin: number,
  end: number,
  context: InternalQueryContext,
  operator: (left: number, right: number) => number,
): PlaybackEvent[] {
  // Squeeze RIGHT into LEFT's event structure.
  // For each outer (left) event, scale inner (right) to fit into that event's span.
  const outerEvents = queryPattern(outerTarget, begin, end, context);
  const events: PlaybackEvent[] = [];

  for (const outerEvent of outerEvents) {
    const eventSpan = outerEvent.end - outerEvent.begin;
    if (eventSpan <= 0) continue;

    // Query inner pattern at a full cycle [0,1) and scale to fit outer event
    const cycleStart = Math.floor(outerEvent.begin);
    const innerEvents = queryPattern(innerTarget, cycleStart, cycleStart + 1, context);

    for (const innerEvent of innerEvents) {
      // Scale inner event to fit within outer event's timespan
      const localBegin = innerEvent.begin - cycleStart;
      const localEnd = innerEvent.end - cycleStart;
      const scaledBegin = outerEvent.begin + localBegin * eventSpan;
      const scaledEnd = outerEvent.begin + localEnd * eventSpan;

      const overlapBegin = Math.max(scaledBegin, outerEvent.begin);
      const overlapEnd = Math.min(scaledEnd, outerEvent.end);
      if (overlapEnd <= overlapBegin) continue;

      const combined = combineEventValues(outerEvent, innerEvent, operator);
      events.push({
        ...combined,
        begin: overlapBegin,
        end: overlapEnd,
        duration: overlapEnd - overlapBegin,
      });
    }
  }

  return events.sort((a, b) => a.begin - b.begin || a.channel.localeCompare(b.channel));
}

export function alignReset(
  leftTarget: ExpressionValue,
  rightTarget: ExpressionValue,
  begin: number,
  end: number,
  context: InternalQueryContext,
  operator: (left: number, right: number) => number,
  restart: boolean,
): PlaybackEvent[] {
  // Reset/restart: for each right event, shift left pattern's cycle position
  const rightEvents = queryPattern(rightTarget, begin, end, context);
  const events: PlaybackEvent[] = [];

  for (const rightEvent of rightEvents) {
    // Determine offset: restart uses absolute begin, reset uses cycle position
    const offset = restart ? rightEvent.begin : normalizeCyclePhase(rightEvent.begin);

    const leftEvents = queryPattern(leftTarget, begin - offset, end - offset, context).map((e) => ({
      ...e,
      begin: e.begin + offset,
      end: e.end + offset,
    }));

    for (const leftEvent of leftEvents) {
      const overlapBegin = Math.max(leftEvent.begin, rightEvent.begin);
      const overlapEnd = Math.min(leftEvent.end, rightEvent.end);
      if (overlapEnd <= overlapBegin) continue;

      const combined = combineEventValues(leftEvent, rightEvent, operator);
      events.push({
        ...combined,
        begin: overlapBegin,
        end: overlapEnd,
        duration: overlapEnd - overlapBegin,
      });
    }
  }

  return events.sort((a, b) => a.begin - b.begin || a.channel.localeCompare(b.channel));
}

export function combineEventValues(
  leftEvent: PlaybackEvent,
  rightEvent: PlaybackEvent,
  operator: (left: number, right: number) => number,
): PlaybackEvent {
  const [leftKey, leftVal] = firstPayloadEntry(leftEvent.payload);
  const [, rightVal] = firstPayloadEntry(rightEvent.payload);

  if (leftKey && typeof leftVal === 'number' && typeof rightVal === 'number') {
    return {
      ...leftEvent,
      payload: { ...leftEvent.payload, [leftKey]: operator(leftVal, rightVal) },
    };
  }

  return leftEvent;
}

export function applyFmap(
  currentEvents: PlaybackEvent[],
  transformExpr: ExpressionValue | undefined,
  begin: number,
  _context: InternalQueryContext,
): PlaybackEvent[] {
  // NOTE: Despite the name "fmap" (functor map), the current IR can only pass
  // scalar values — not arbitrary functions.  When a scalar is provided the
  // operation is addition, mirroring Strudel's `withValue(v => v + n)` shorthand.
  if (transformExpr === undefined) return currentEvents;
  const factor = evaluateNumericValue(transformExpr, begin);
  if (factor === undefined) return currentEvents;
  return mapNumericPayload(currentEvents, (val) => val + factor);
}

export function repeatEventWithinCycle(
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

type AlignmentMode = 'in' | 'mix' | 'out' | 'reset' | 'restart' | 'squeeze' | 'squeezeout';

export function clipEvent(event: PlaybackEvent, begin: number, end: number): PlaybackEvent | undefined {
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

export function mapNumericPayload(
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

export function shiftEvents(
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

export function remapCycleWindows(
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
