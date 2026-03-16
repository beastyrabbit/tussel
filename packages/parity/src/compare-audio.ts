import type { AudioCompareMode, AudioComparisonResult, AudioToleranceThresholds } from './schema.js';

interface ParsedWav {
  channels: number;
  data: Buffer;
  sampleRate: number;
}

export function compareAudio(expected: Buffer, actual: Buffer): AudioComparisonResult {
  const oracle = parseWav(expected);
  const rendered = parseWav(actual);
  const expectedSilent = isSilentPcm(oracle.data);
  const actualSilent = isSilentPcm(rendered.data);
  if (oracle.channels !== rendered.channels || oracle.sampleRate !== rendered.sampleRate) {
    return {
      actualBytes: rendered.data.byteLength,
      actualSilent,
      expectedBytes: oracle.data.byteLength,
      expectedSilent,
      ok: false,
    };
  }
  if (expectedSilent && actualSilent) {
    return {
      actualBytes: rendered.data.byteLength,
      actualSilent,
      expectedBytes: oracle.data.byteLength,
      expectedSilent,
      ok: true,
    };
  }
  if (expectedSilent || actualSilent) {
    return {
      actualBytes: rendered.data.byteLength,
      actualSilent,
      expectedBytes: oracle.data.byteLength,
      expectedSilent,
      ok: false,
    };
  }

  const maxLength = Math.max(oracle.data.byteLength, rendered.data.byteLength);
  let firstMismatchSample: number | undefined;
  let maxAbsoluteDelta = 0;
  let sumSquares = 0;

  for (let offset = 0; offset < maxLength; offset += 2) {
    const left = offset < oracle.data.byteLength ? oracle.data.readInt16LE(offset) : 0;
    const right = offset < rendered.data.byteLength ? rendered.data.readInt16LE(offset) : 0;
    const delta = Math.abs(left - right);
    if (delta > 0 && firstMismatchSample === undefined) {
      firstMismatchSample = Math.floor(offset / 2);
    }
    maxAbsoluteDelta = Math.max(maxAbsoluteDelta, delta);
    sumSquares += delta ** 2;
  }

  return {
    actualBytes: rendered.data.byteLength,
    actualSilent,
    expectedBytes: oracle.data.byteLength,
    expectedSilent,
    firstMismatchSample,
    maxAbsoluteDelta,
    ok: firstMismatchSample === undefined && oracle.data.equals(rendered.data),
    rmsDelta: maxLength === 0 ? 0 : Math.sqrt(sumSquares / Math.max(1, maxLength / 2)),
  };
}

function parseWav(buffer: Buffer): ParsedWav {
  const header = buffer.subarray(0, 44);
  if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Expected canonical RIFF/WAVE data');
  }
  const channels = header.readUInt16LE(22);
  const sampleRate = header.readUInt32LE(24);
  const bitDepth = header.readUInt16LE(34);
  if (channels !== 2 || sampleRate !== 48_000 || bitDepth !== 16) {
    throw new Error(`Expected stereo 48k PCM16 wav, received ${channels}ch ${sampleRate}Hz ${bitDepth}-bit`);
  }
  return {
    channels,
    data: buffer.subarray(44),
    sampleRate,
  };
}

export function isAudibleWav(buffer: Buffer | undefined): boolean {
  if (!buffer || buffer.byteLength <= 44) {
    return false;
  }
  return !isSilentPcm(buffer.subarray(44));
}

/**
 * Default tolerance for audio parity comparison.
 *
 * On 16-bit PCM (range ±32767):
 * - maxAbsoluteDelta 100 ≈ 0.3% of full scale — allows minor float rounding
 *   differences between tussel and Strudel audio engines.
 * - rmsDelta 20 ≈ 0.06% RMS — catches gross mismatches while tolerating
 *   micro-level differences from independent oscillator/filter implementations.
 *
 * These thresholds were empirically tuned to pass known-correct comparisons
 * while catching real regressions (wrong frequencies, missing effects, etc.).
 */
export const DEFAULT_AUDIO_TOLERANCE: AudioToleranceThresholds = {
  maxAbsoluteDelta: 100,
  rmsDelta: 20,
};

export function compareAudioWithTolerance(
  expected: Buffer,
  actual: Buffer,
  thresholds: AudioToleranceThresholds = DEFAULT_AUDIO_TOLERANCE,
): AudioComparisonResult {
  const result = compareAudio(expected, actual);
  if (result.ok) {
    return result;
  }

  const maxDeltaOk =
    thresholds.maxAbsoluteDelta === undefined ||
    (result.maxAbsoluteDelta ?? 0) <= thresholds.maxAbsoluteDelta;

  const rmsOk = thresholds.rmsDelta === undefined || (result.rmsDelta ?? 0) <= thresholds.rmsDelta;

  const bothNonSilent = !result.expectedSilent && !result.actualSilent;

  return {
    ...result,
    ok: bothNonSilent && maxDeltaOk && rmsOk,
  };
}

/**
 * Compare two WAV buffers using only the RMS energy of the difference signal.
 *
 * Useful when you care about overall signal similarity but can tolerate
 * occasional large per-sample spikes (e.g., phase-shifted clicks).
 *
 * @param maxRmsDelta  Maximum RMS of the difference signal (PCM16 scale).
 *                     Defaults to {@link DEFAULT_AUDIO_TOLERANCE.rmsDelta}.
 */
export function compareAudioRms(
  expected: Buffer,
  actual: Buffer,
  maxRmsDelta: number = DEFAULT_AUDIO_TOLERANCE.rmsDelta ?? 20,
): AudioComparisonResult {
  return compareAudioWithTolerance(expected, actual, { rmsDelta: maxRmsDelta });
}

/**
 * Compare two WAV buffers using only the maximum per-sample delta.
 *
 * Useful when you need a hard ceiling on how far any individual sample
 * can deviate, regardless of overall energy difference.
 *
 * @param maxSampleDelta  Maximum absolute per-sample difference (PCM16 scale).
 *                        Defaults to {@link DEFAULT_AUDIO_TOLERANCE.maxAbsoluteDelta}.
 */
export function compareAudioMaxDelta(
  expected: Buffer,
  actual: Buffer,
  maxSampleDelta: number = DEFAULT_AUDIO_TOLERANCE.maxAbsoluteDelta ?? 100,
): AudioComparisonResult {
  return compareAudioWithTolerance(expected, actual, { maxAbsoluteDelta: maxSampleDelta });
}

/**
 * Options for {@link compareAudioWithMode}.
 */
export interface AudioCompareOptions {
  /** Maximum absolute per-sample delta (used by `'max-delta'` and `'tolerance'` modes). */
  maxAbsoluteDelta?: number;
  /** Comparison strategy. Defaults to `'exact'`. */
  mode?: AudioCompareMode;
  /** Maximum RMS of the difference signal (used by `'rms'` and `'tolerance'` modes). */
  rmsDelta?: number;
}

/**
 * Unified entry point that dispatches to the appropriate comparison function
 * based on the requested mode.  Keeps the existing exact comparison as the
 * default so callers that don't pass options get unchanged behaviour.
 */
export function compareAudioWithMode(
  expected: Buffer,
  actual: Buffer,
  options: AudioCompareOptions = {},
): AudioComparisonResult {
  const { mode = 'exact' } = options;

  switch (mode) {
    case 'exact':
      return compareAudio(expected, actual);
    case 'rms':
      return compareAudioRms(expected, actual, options.rmsDelta);
    case 'max-delta':
      return compareAudioMaxDelta(expected, actual, options.maxAbsoluteDelta);
    case 'tolerance':
      return compareAudioWithTolerance(expected, actual, {
        maxAbsoluteDelta: options.maxAbsoluteDelta,
        rmsDelta: options.rmsDelta,
      });
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unknown audio compare mode: ${_exhaustive}`);
    }
  }
}

function isSilentPcm(data: Buffer): boolean {
  for (let offset = 0; offset + 1 < data.byteLength; offset += 2) {
    if (data.readInt16LE(offset) !== 0) {
      return false;
    }
  }
  return true;
}
