/**
 * Pure utility functions for the Tussel core engine.
 *
 * These functions have no internal dependencies and are used throughout
 * the pattern evaluator, scheduler, and signal evaluation.
 */

import type { ExpressionValue } from '@tussel/ir';
import type { PlaybackEvent } from './types.js';

/**
 * Deterministic pseudo-random number generator using GLSL-style sin hash.
 *
 * Has known pattern artifacts at extreme seeds, but changing this PRNG would
 * break audio parity with Strudel since degrade/sometimesBy depend on
 * deterministic random sequences.
 */
export function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * DJB2-style string hash. Multiplier 31 gives good distribution for
 * typical channel/sound name lengths.
 */
export function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Hash a PlaybackEvent for deterministic operations (degrade, sometimesBy).
 * XORs begin/end positions with channel and payload hashes.
 */
export function hashEvent(event: PlaybackEvent): number {
  return (
    Math.floor(event.begin * 10_000) ^
    Math.floor(event.end * 10_000) ^
    hashString(event.channel) ^
    hashString(JSON.stringify(event.payload))
  );
}

/**
 * Generate a Fisher-Yates shuffled index array using deterministic seeded random.
 * Prime multipliers 53 and 97 distribute hash values across the index space.
 */
export function shuffledIndices(count: number, seed: number): number[] {
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

/** Modulo that always returns a non-negative result. */
export function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** Normalize a cycle position to the [0, 1) range. */
export function normalizeCyclePhase(value: number): number {
  return positiveMod(value, 1);
}

/**
 * Parse a weighted entry from `[value, weight]` format used in
 * choose/wchoose patterns. Falls back to weight 1 for bare values.
 */
export function normalizeWeightedEntry(
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

/**
 * Hermite-interpolated noise for Perlin-style continuous randomness.
 * Uses seededRandom at integer boundaries with smooth cubic interpolation.
 */
export function smoothNoise(value: number): number {
  const floor = Math.floor(value);
  const t = value - floor;
  const left = seededRandom(floor);
  const right = seededRandom(floor + 1);
  return left + (right - left) * (t * t * (3 - 2 * t));
}

/** Clamp a value to [min, max], returning fallback if input is not a finite number. */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

/** Least common multiple of two positive integers. */
export function leastCommonMultiple(a: number, b: number): number {
  return (a * b) / gcdIntegers(a, b);
}

/** LCM of an array of positive integers. */
export function lcmIntegers(values: number[]): number {
  return values.reduce((a, b) => leastCommonMultiple(a, b), 1);
}

/** Greatest common divisor using Euclidean algorithm. */
export function gcdIntegers(a: number, b: number): number {
  while (b !== 0) {
    const temp = b;
    b = a % b;
    a = temp;
  }
  return a;
}
