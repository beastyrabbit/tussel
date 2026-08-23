import { createLogger, type ExpressionValue, isExpressionNode } from '@tussel/ir';
import { queryMini } from '@tussel/mini';
import { type InternalQueryContext, queryPattern } from './index.js';
import { evaluateSignalExpression } from './signals.js';
import type { PlaybackEvent } from './types.js';

const coreLogger = createLogger('tussel/core');

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

export function resolvePropertyValue(
  value: ExpressionValue | undefined,
  cycle: number,
  _cps: number,
): unknown {
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
    } catch (error) {
      // Mini notation parse failed — treat the raw string as a literal value.
      // Only warn for strings that look like mini notation attempts (contain
      // spaces, brackets, or operators). Simple identifiers like sound names
      // ('bd', 'hh', 'c4') are expected to fail parsing and need no warning.
      if (/[\s[\]<>{}*|,]/.test(value)) {
        coreLogger.warnOnce(
          `TUSSEL_MINI_PARSE_FALLBACK:${value}`,
          `mini notation parse failed for "${value}", treating as literal string: ${error instanceof Error ? error.message : String(error)}`,
          { value },
        );
      }
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

export function coerceMiniValue(value: string): number | string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

export function evaluateMiniNumber(source: string, cycle: number): number | undefined {
  const hits = queryMini(source, cycle, cycle + 1e-9).find(
    (event) => event.begin <= cycle && event.end > cycle,
  );
  if (!hits) {
    return undefined;
  }
  const numeric = Number(hits.value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function evaluatePatternValue(value: ExpressionValue, cycle: number): unknown {
  const events = queryPattern(value, cycle, cycle + Number.EPSILON * 10, { channel: '$value', cps: 1 });
  const hit = events.find((event: PlaybackEvent) => event.begin <= cycle && event.end > cycle) ?? events[0];
  return hit ? extractEventValue(hit.payload) : undefined;
}

export function queryValueEvents(
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
  return events.map((event: PlaybackEvent) => ({
    begin: event.begin,
    end: event.end,
    value: extractEventValue(event.payload),
  }));
}

export function extractEventValue(payload: Record<string, unknown>): unknown {
  if ('value' in payload) {
    return payload.value;
  }

  const firstKey = Object.keys(payload)[0];
  return firstKey ? payload[firstKey] : undefined;
}

export function firstPayloadEntry(payload: Record<string, unknown>): [string | undefined, unknown] {
  const firstKey = Object.keys(payload)[0];
  return [firstKey, firstKey ? payload[firstKey] : undefined];
}

export function isTruthyMaskValue(value: unknown): boolean {
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
