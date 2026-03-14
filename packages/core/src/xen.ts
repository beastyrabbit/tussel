/**
 * EDO (Equal Division of the Octave) and xenharmonic tuning utilities.
 *
 * Standard 12-TET is just 12-EDO. This module generalises frequency
 * calculation to any N-EDO system and provides helpers for working
 * with cents and just-intonation ratios.
 */

/** Default base frequency — middle C (C4) in 12-TET. */
const DEFAULT_BASE_FREQ = 261.63;

/** Number of cents in one octave — the standard unit for measuring musical intervals. */
const CENTS_PER_OCTAVE = 1200;

/**
 * Calculate the frequency for a given step in N-EDO tuning.
 *
 * Formula: `baseFreq * 2^(step / edo)`
 *
 * @param step  The step number (can be fractional or negative).
 * @param edo   Number of equal divisions of the octave.
 * @param baseFreq  Reference frequency for step 0 (defaults to C4 = 261.63 Hz).
 * @returns Frequency in Hz.
 */
export function edoFrequency(step: number, edo: number, baseFreq: number = DEFAULT_BASE_FREQ): number {
  if (edo <= 0) {
    throw new RangeError(`EDO divisions must be positive, got ${edo}`);
  }
  return baseFreq * 2 ** (step / edo);
}

/**
 * Convert a cent value to a frequency ratio.
 *
 * 1200 cents = one octave = ratio 2.
 *
 * @param cents  Interval size in cents.
 * @returns Frequency ratio (dimensionless).
 */
export function centsToRatio(cents: number): number {
  return 2 ** (cents / CENTS_PER_OCTAVE);
}

/**
 * Convert a frequency ratio to cents.
 *
 * @param ratio  Frequency ratio (must be > 0).
 * @returns Interval size in cents.
 */
export function ratioToCents(ratio: number): number {
  if (ratio <= 0) {
    throw new RangeError(`Ratio must be positive, got ${ratio}`);
  }
  return CENTS_PER_OCTAVE * Math.log2(ratio);
}

/**
 * Create a function that maps step numbers to frequencies in the
 * given N-EDO tuning system.
 *
 * @param edo       Number of equal divisions of the octave.
 * @param baseFreq  Reference frequency for step 0 (defaults to C4).
 * @returns A function `(step: number) => number` returning Hz.
 */
export function createEdoScale(edo: number, baseFreq: number = DEFAULT_BASE_FREQ): (step: number) => number {
  if (edo <= 0) {
    throw new RangeError(`EDO divisions must be positive, got ${edo}`);
  }
  return (step: number) => baseFreq * 2 ** (step / edo);
}

/**
 * Parse xenharmonic notation strings.
 *
 * Supported formats:
 * - `"7\\12"` — 7 steps of 12-EDO, returns the frequency ratio `2^(7/12)`.
 * - `"3/2"`  — just ratio, returns `1.5`.
 * - `"5/4"`  — just ratio, returns `1.25`.
 * - `"700.0"` — cents value (any number containing a decimal point that
 *                is not a simple integer ratio), returns `centsToRatio(700)`.
 *
 * @param notation  A xen notation string.
 * @returns The corresponding frequency ratio, or `undefined` if unparseable.
 */
export function parseXenValue(notation: string): number | undefined {
  const trimmed = notation.trim();
  if (!trimmed) {
    return undefined;
  }

  // EDO step notation: "7\12" means 7 steps of 12-EDO
  // In source strings the backslash may appear as a single character.
  if (trimmed.includes('\\')) {
    const parts = trimmed.split('\\');
    if (parts.length === 2) {
      const step = Number(parts[0]);
      const edo = Number(parts[1]);
      if (Number.isFinite(step) && Number.isFinite(edo) && edo > 0) {
        return 2 ** (step / edo);
      }
    }
    return undefined;
  }

  // Just ratio notation: "3/2", "5/4", etc.
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    if (parts.length === 2) {
      const num = Number(parts[0]);
      const den = Number(parts[1]);
      if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
        return num / den;
      }
    }
    return undefined;
  }

  // Plain number — treat as cents if it contains a decimal point,
  // otherwise treat as a raw ratio.
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  if (trimmed.includes('.')) {
    // Interpret as cents
    return centsToRatio(numeric);
  }

  // A bare integer without slash or backslash — treat as a raw ratio
  return numeric;
}

/**
 * Resolve a frequency using EDO tuning when `payload.edo` is set.
 *
 * This is meant to be called from the audio engine's `resolveFrequency`
 * when the event carries an `edo` property.
 *
 * @param step  The note/step value (numeric).
 * @param edo   Number of equal divisions of the octave.
 * @param baseFreq  Optional base frequency (defaults to C4).
 * @returns Frequency in Hz.
 */
export function resolveEdoFrequency(step: number, edo: number, baseFreq?: number): number {
  return edoFrequency(step, edo, baseFreq);
}
