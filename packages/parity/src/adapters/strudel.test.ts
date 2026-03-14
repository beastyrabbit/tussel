import { describe, expect, it } from 'vitest';
import { renderStrudelAudio } from './strudel.js';

describe('Strudel reference audio adapter', () => {
  it('keeps note-only patterns audible through Strudel defaults', async () => {
    const wav = await renderStrudelAudio(`note("a3 c#4 e4 a4")`, {
      cps: 1,
      durationCycles: 4,
    });

    expect(maxSampleMagnitude(wav)).toBeGreaterThan(0);
  });
});

function maxSampleMagnitude(wav: Buffer): number {
  let max = 0;
  for (let offset = 44; offset + 1 < wav.byteLength; offset += 2) {
    max = Math.max(max, Math.abs(wav.readInt16LE(offset)));
  }
  return max;
}
