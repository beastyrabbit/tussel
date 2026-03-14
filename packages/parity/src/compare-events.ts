import type { EventComparisonResult, NormalizedEvent } from './schema.js';

export function compareEvents(expected: NormalizedEvent[], actual: NormalizedEvent[]): EventComparisonResult {
  const normalizedExpected = [...expected].sort(compareEvent);
  const normalizedActual = [...actual].sort(compareEvent);
  const count = Math.max(normalizedExpected.length, normalizedActual.length);

  for (let index = 0; index < count; index += 1) {
    const left = normalizedExpected[index];
    const right = normalizedActual[index];
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      return {
        firstMismatch: {
          actual: right,
          expected: left,
          index,
        },
        ok: false,
      };
    }
  }

  return { ok: true };
}

function compareEvent(left: NormalizedEvent, right: NormalizedEvent): number {
  return (
    left.begin - right.begin ||
    left.end - right.end ||
    left.channel.localeCompare(right.channel) ||
    JSON.stringify(left.payload).localeCompare(JSON.stringify(right.payload))
  );
}
