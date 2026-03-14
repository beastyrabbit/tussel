import { describe, expect, it } from 'vitest';
import { compareAudio, isAudibleWav } from './compare-audio.js';

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
  it('accepts matching silent renders and rejects one-sided silence', () => {
    const silent = createWav([0, 0, 0, 0]);
    const audible = createWav([0, 1200, -1200, 0]);

    expect(compareAudio(silent, silent)).toMatchObject({
      actualSilent: true,
      expectedSilent: true,
      ok: true,
    });
    expect(compareAudio(audible, silent)).toMatchObject({
      actualSilent: true,
      expectedSilent: false,
      ok: false,
    });
  });

  it('detects audible canonical wav buffers', () => {
    expect(isAudibleWav(createWav([0, 900, 0, 0]))).toBe(true);
    expect(isAudibleWav(createWav([0, 0, 0, 0]))).toBe(false);
  });
});
