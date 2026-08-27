import { describe, expect, it } from 'vitest';
import {
  decodePcmWav,
  encodeCanonicalWav,
  encodeWavFromFloat32Channels,
  inspectWav,
  parseCanonicalWav,
} from './wav.js';

describe('WAV helpers', () => {
  it('encodes, inspects, parses, and decodes canonical PCM16 audio', () => {
    const wav = encodeWavFromFloat32Channels(48_000, [
      Float32Array.from([-1, 0.5]),
      Float32Array.from([1, -0.5]),
    ]);

    expect(inspectWav(wav)).toEqual({
      bitDepth: 16,
      channels: 2,
      dataLength: 8,
      dataOffset: 44,
      format: 1,
      sampleRate: 48_000,
    });
    expect(parseCanonicalWav(wav).data).toHaveLength(8);
    const decoded = decodePcmWav(wav);
    expect([...(decoded.channels[0] ?? [])]).toEqual([-1, 0.499969482421875]);
    expect([...(decoded.channels[1] ?? [])]).toEqual([0.999969482421875, -0.5]);
  });

  it('rejects chunks whose declared body extends beyond the RIFF buffer', () => {
    const wav = encodeCanonicalWav(48_000, 1, Buffer.alloc(2));
    wav.writeUInt32LE(1024, 40);

    expect(() => inspectWav(wav)).toThrow('chunk exceeds buffer');
    expect(() => decodePcmWav(wav)).toThrow('chunk exceeds buffer');
  });

  it('rejects short format chunks before reading their fields', () => {
    const wav = Buffer.alloc(24);
    wav.write('RIFF', 0, 'ascii');
    wav.writeUInt32LE(16, 4);
    wav.write('WAVE', 8, 'ascii');
    wav.write('fmt ', 12, 'ascii');
    wav.writeUInt32LE(4, 16);

    expect(() => inspectWav(wav)).toThrow('shorter than 16 bytes');
  });

  it('rejects a missing pad byte after an odd-sized chunk', () => {
    const wav = Buffer.alloc(21);
    wav.write('RIFF', 0, 'ascii');
    wav.writeUInt32LE(13, 4);
    wav.write('WAVE', 8, 'ascii');
    wav.write('JUNK', 12, 'ascii');
    wav.writeUInt32LE(1, 16);

    expect(() => inspectWav(wav)).toThrow('padding exceeds buffer');
  });

  it('rejects partial frames and mismatched channel lengths when encoding', () => {
    expect(() => encodeCanonicalWav(48_000, 2, Buffer.alloc(2))).toThrow('whole interleaved frames');
    expect(() => encodeWavFromFloat32Channels(48_000, [new Float32Array(2), new Float32Array(1)])).toThrow(
      'same number of frames',
    );
  });

  it('rejects inconsistent canonical length fields', () => {
    const wav = encodeCanonicalWav(48_000, 1, Buffer.alloc(2));
    wav.writeUInt32LE(0, 40);

    expect(() => parseCanonicalWav(wav)).toThrow('Malformed canonical');
  });
});
