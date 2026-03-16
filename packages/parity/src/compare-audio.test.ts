import { describe, expect, it } from 'vitest';
import {
  compareAudio,
  compareAudioMaxDelta,
  compareAudioRms,
  compareAudioWithMode,
  compareAudioWithTolerance,
  DEFAULT_AUDIO_TOLERANCE,
  isAudibleWav,
} from './compare-audio.js';

function createWav(samples: number[]): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    data.writeInt16LE(sample, index * 2);
  });

  const result = Buffer.alloc(data.byteLength + 44);
  result.write('RIFF', 0, 'ascii');
  result.writeUInt32LE(result.byteLength - 8, 4);
  result.write('WAVE', 8, 'ascii');
  result.write('fmt ', 12, 'ascii');
  result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20);
  result.writeUInt16LE(2, 22);
  result.writeUInt32LE(48_000, 24);
  result.writeUInt32LE(48_000 * 2 * 2, 28);
  result.writeUInt16LE(4, 32);
  result.writeUInt16LE(16, 34);
  result.write('data', 36, 'ascii');
  result.writeUInt32LE(data.byteLength, 40);
  data.copy(result, 44);
  return result;
}

describe('compareAudio', () => {
  it('accepts matching silent renders as ok (both-silent means they agree)', () => {
    const silent = createWav([0, 0, 0, 0]);
    expect(compareAudio(silent, silent)).toMatchObject({
      actualSilent: true,
      expectedSilent: true,
      ok: true,
    });
  });

  it('rejects one-sided silence', () => {
    const silent = createWav([0, 0, 0, 0]);
    const audible = createWav([0, 1200, -1200, 0]);
    expect(compareAudio(audible, silent)).toMatchObject({
      actualSilent: true,
      expectedSilent: false,
      ok: false,
    });
    expect(compareAudio(silent, audible)).toMatchObject({
      actualSilent: false,
      expectedSilent: true,
      ok: false,
    });
  });

  it('reports matching non-silent buffers as ok', () => {
    const a = createWav([100, 200, -100, -200]);
    const result = compareAudio(a, a);
    expect(result.ok).toBe(true);
    expect(result.maxAbsoluteDelta).toBe(0);
    expect(result.rmsDelta).toBe(0);
  });

  it('reports exact sample mismatch details', () => {
    const a = createWav([100, 200, 300, 400]);
    const b = createWav([100, 210, 300, 400]);
    const result = compareAudio(a, b);
    expect(result.ok).toBe(false);
    expect(result.firstMismatchSample).toBe(1);
    expect(result.maxAbsoluteDelta).toBe(10);
    expect(result.rmsDelta).toBeGreaterThan(0);
  });

  it('handles different-length buffers', () => {
    const short = createWav([100, 200]);
    const long = createWav([100, 200, 300, 400]);
    const result = compareAudio(short, long);
    expect(result.ok).toBe(false);
    expect(result.expectedBytes).toBe(4);
    expect(result.actualBytes).toBe(8);
  });

  it('detects audible canonical wav buffers', () => {
    expect(isAudibleWav(createWav([0, 900, 0, 0]))).toBe(true);
    expect(isAudibleWav(createWav([0, 0, 0, 0]))).toBe(false);
  });
});

describe('compareAudioWithTolerance', () => {
  it('passes exact matches', () => {
    const a = createWav([100, 200, -100, -200]);
    const result = compareAudioWithTolerance(a, a);
    expect(result.ok).toBe(true);
  });

  it('passes small deltas within default tolerance', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([1005, 2010, -990, -2005]);
    const result = compareAudioWithTolerance(a, b);
    expect(result.ok).toBe(true);
    expect(DEFAULT_AUDIO_TOLERANCE.maxAbsoluteDelta).toBeDefined();
    expect(result.maxAbsoluteDelta).toBeLessThanOrEqual(DEFAULT_AUDIO_TOLERANCE.maxAbsoluteDelta!);
  });

  it('rejects large deltas exceeding tolerance', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([1000, 5000, -1000, -2000]);
    const result = compareAudioWithTolerance(a, b, { maxAbsoluteDelta: 100 });
    expect(result.ok).toBe(false);
  });

  it('rejects when one side is silent', () => {
    const silent = createWav([0, 0, 0, 0]);
    const audible = createWav([1000, 2000, -1000, -2000]);
    const result = compareAudioWithTolerance(audible, silent);
    expect(result.ok).toBe(false);
  });

  it('respects custom rms threshold', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([1010, 2020, -1010, -2020]);
    const strict = compareAudioWithTolerance(a, b, { rmsDelta: 1 });
    const relaxed = compareAudioWithTolerance(a, b, { rmsDelta: 100 });
    expect(strict.ok).toBe(false);
    expect(relaxed.ok).toBe(true);
  });

  it('allows partial threshold specification', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([1005, 2005, -1005, -2005]);
    const rmsOnly = compareAudioWithTolerance(a, b, { rmsDelta: 50 });
    expect(rmsOnly.ok).toBe(true);
  });
});

describe('compareAudioRms', () => {
  it('passes exact matches', () => {
    const a = createWav([500, 1000, -500, -1000]);
    expect(compareAudioRms(a, a).ok).toBe(true);
  });

  it('passes small RMS differences within threshold', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([1002, 2004, -998, -1996]);
    expect(compareAudioRms(a, b, 50).ok).toBe(true);
  });

  it('fails large RMS differences exceeding threshold', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([2000, 4000, -2000, -4000]);
    expect(compareAudioRms(a, b, 5).ok).toBe(false);
  });

  it('uses default threshold when none specified', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([1005, 2005, -1005, -2005]);
    // Small differences should pass with default threshold
    expect(compareAudioRms(a, b).ok).toBe(true);
  });

  it('ignores max-delta — only checks RMS', () => {
    // One sample has a large spike, but the overall RMS is still small
    const a = createWav([1000, 2000, 3000, 4000]);
    const b = createWav([1000, 2000, 3000, 4080]);
    // maxAbsoluteDelta = 80, but RMS should be small
    const result = compareAudioRms(a, b, 100);
    expect(result.ok).toBe(true);
    expect(result.maxAbsoluteDelta).toBe(80);
  });

  it('accepts both-silent buffers as matching', () => {
    const silent = createWav([0, 0, 0, 0]);
    expect(compareAudioRms(silent, silent, 1000).ok).toBe(true);
  });

  it('handles different-length buffers', () => {
    const short = createWav([1000, 2000]);
    const long = createWav([1000, 2000, 3000, 4000]);
    // Extra samples treated as delta against 0, producing large RMS
    const result = compareAudioRms(short, long, 1);
    expect(result.ok).toBe(false);
  });
});

describe('compareAudioMaxDelta', () => {
  it('passes exact matches', () => {
    const a = createWav([500, 1000, -500, -1000]);
    expect(compareAudioMaxDelta(a, a).ok).toBe(true);
  });

  it('passes when all sample deltas are within threshold', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([1010, 2010, -990, -1990]);
    expect(compareAudioMaxDelta(a, b, 50).ok).toBe(true);
  });

  it('fails when any single sample exceeds threshold', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([1000, 2200, -1000, -2000]);
    expect(compareAudioMaxDelta(a, b, 100).ok).toBe(false);
  });

  it('uses default threshold when none specified', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([1005, 2005, -1005, -2005]);
    expect(compareAudioMaxDelta(a, b).ok).toBe(true);
  });

  it('ignores RMS — only checks max sample delta', () => {
    // Many small deltas give high RMS, but max delta is small
    const a = createWav([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]);
    const b = createWav([1020, 2020, 3020, 4020, 5020, 6020, 7020, 8020]);
    const result = compareAudioMaxDelta(a, b, 50);
    expect(result.ok).toBe(true);
    expect(result.maxAbsoluteDelta).toBe(20);
  });

  it('accepts both-silent buffers as matching', () => {
    const silent = createWav([0, 0, 0, 0]);
    expect(compareAudioMaxDelta(silent, silent, 1000).ok).toBe(true);
  });

  it('handles different-length buffers', () => {
    const short = createWav([1000, 2000]);
    const long = createWav([1000, 2000, 3000, 4000]);
    // Missing samples are treated as 0, so delta for sample 2 = 3000
    const result = compareAudioMaxDelta(short, long, 100);
    expect(result.ok).toBe(false);
    expect(result.maxAbsoluteDelta).toBeGreaterThan(100);
  });
});

describe('compareAudioWithMode', () => {
  it('defaults to exact comparison', () => {
    const a = createWav([100, 200, -100, -200]);
    const b = createWav([101, 200, -100, -200]);
    // Default (exact) mode rejects even 1-sample difference
    expect(compareAudioWithMode(a, a).ok).toBe(true);
    expect(compareAudioWithMode(a, b).ok).toBe(false);
  });

  it('exact mode matches compareAudio behaviour', () => {
    const a = createWav([100, 200, 300, 400]);
    const b = createWav([100, 210, 300, 400]);
    const exact = compareAudioWithMode(a, b, { mode: 'exact' });
    const baseline = compareAudio(a, b);
    expect(exact.ok).toBe(baseline.ok);
    expect(exact.maxAbsoluteDelta).toBe(baseline.maxAbsoluteDelta);
    expect(exact.rmsDelta).toBe(baseline.rmsDelta);
  });

  it('rms mode passes when RMS is within threshold', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([1005, 2005, -1005, -2005]);
    expect(compareAudioWithMode(a, b, { mode: 'rms', rmsDelta: 50 }).ok).toBe(true);
  });

  it('rms mode fails when RMS exceeds threshold', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([2000, 4000, -2000, -4000]);
    expect(compareAudioWithMode(a, b, { mode: 'rms', rmsDelta: 1 }).ok).toBe(false);
  });

  it('max-delta mode passes when all deltas are within threshold', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([1010, 2010, -990, -1990]);
    expect(compareAudioWithMode(a, b, { mode: 'max-delta', maxAbsoluteDelta: 50 }).ok).toBe(true);
  });

  it('max-delta mode fails when any delta exceeds threshold', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([1000, 3000, -1000, -2000]);
    expect(compareAudioWithMode(a, b, { mode: 'max-delta', maxAbsoluteDelta: 50 }).ok).toBe(false);
  });

  it('tolerance mode requires both RMS and max-delta to pass', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([1010, 2010, -990, -1990]);
    // Both thresholds generous enough
    expect(
      compareAudioWithMode(a, b, { maxAbsoluteDelta: 50, mode: 'tolerance', rmsDelta: 50 }).ok,
    ).toBe(true);
    // RMS ok, but maxAbsoluteDelta too strict
    expect(
      compareAudioWithMode(a, b, { maxAbsoluteDelta: 1, mode: 'tolerance', rmsDelta: 50 }).ok,
    ).toBe(false);
    // maxAbsoluteDelta ok, but RMS too strict
    expect(
      compareAudioWithMode(a, b, { maxAbsoluteDelta: 50, mode: 'tolerance', rmsDelta: 1 }).ok,
    ).toBe(false);
  });

  it('tolerance mode uses defaults when thresholds not specified', () => {
    const a = createWav([1000, 2000, -1000, -2000]);
    const b = createWav([1005, 2005, -1005, -2005]);
    expect(compareAudioWithMode(a, b, { mode: 'tolerance' }).ok).toBe(true);
  });

  it('both-silent buffers are accepted as matching in exact mode', () => {
    const silent = createWav([0, 0, 0, 0]);
    expect(compareAudioWithMode(silent, silent, { mode: 'exact' }).ok).toBe(true);
  });

  it('rejects one-sided silence in every mode', () => {
    const silent = createWav([0, 0, 0, 0]);
    const audible = createWav([1000, 2000, -1000, -2000]);
    for (const mode of ['exact', 'rms', 'max-delta', 'tolerance'] as const) {
      expect(compareAudioWithMode(audible, silent, { mode }).ok).toBe(false);
      expect(compareAudioWithMode(silent, audible, { mode }).ok).toBe(false);
    }
  });

  it('handles different-length buffers in every mode', () => {
    const short = createWav([1000, 2000]);
    const long = createWav([1000, 2000, 3000, 4000]);
    // Exact always fails for different lengths
    expect(compareAudioWithMode(short, long, { mode: 'exact' }).ok).toBe(false);
    // Other modes fail because the missing samples create large deltas
    expect(compareAudioWithMode(short, long, { mode: 'rms', rmsDelta: 1 }).ok).toBe(false);
    expect(compareAudioWithMode(short, long, { mode: 'max-delta', maxAbsoluteDelta: 1 }).ok).toBe(false);
  });
});
