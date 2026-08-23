import {
  type ExpressionNode,
  type ExpressionValue,
  getInputValue,
  isExpressionNode,
  resolveGamepadInputKey,
  resolveInputKey,
  resolveMidiInputKey,
  resolveMotionInputKey,
} from '@tussel/ir';
import { evaluateMiniNumber, resolvePropertyValue } from './evaluate.js';
import { seededRandom, smoothNoise } from './utils.js';

export function clampSignalResult(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function evaluateSignalExpression(expr: ExpressionNode, cycle: number): number {
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
      case 'midin':
        return coerceSignalNumber(
          getInputValue(
            resolveMidiInputKey('note', `${expr.args[0] ?? 'default'}`),
            resolveSignalFallback(expr.args[1]),
          ),
        );
      case 'midikeys':
        return coerceSignalNumber(
          getInputValue(
            resolveMidiInputKey('keys', `${expr.args[0] ?? 'default'}`),
            resolveSignalFallback(expr.args[1]),
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
      return clampSignalResult(target + evaluateSignalValue(expr.args[0], cycle));
    case 'sub':
      return clampSignalResult(target - evaluateSignalValue(expr.args[0], cycle));
    case 'mul':
      return clampSignalResult(target * evaluateSignalValue(expr.args[0], cycle));
    case 'div':
      return clampSignalResult(target / Math.max(1e-9, evaluateSignalValue(expr.args[0], cycle)));
    default:
      return target;
  }
}

export function evaluateSignalValue(value: ExpressionValue | undefined, cycle: number): number {
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

export function resolveSignalFallback(value: ExpressionValue | undefined): number {
  return coerceSignalNumber(resolvePropertyValue(value, 0, 1));
}

export function coerceSignalNumber(value: unknown): number {
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
