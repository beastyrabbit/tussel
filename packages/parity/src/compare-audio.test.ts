import { describe, expect, it } from 'vitest';
import {
  compareAudio,
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
  it('rejects matching silent renders as a hard failure', () => {
    const silent = createWav([0, 0, 0, 0]);
    expect(compareAudio(silent, silent)).toMatchObject({
      actualSilent: true,
      expectedSilent: true,
      ok: false,
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
