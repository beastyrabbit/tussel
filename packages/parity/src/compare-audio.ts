import type { AudioComparisonResult } from './schema.js';

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
  if (expectedSilent || actualSilent) {
    return {
      actualBytes: rendered.data.byteLength,
      actualSilent,
      expectedBytes: oracle.data.byteLength,
      expectedSilent,
      ok: expectedSilent && actualSilent && oracle.data.equals(rendered.data),
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

function isSilentPcm(data: Buffer): boolean {
  for (let offset = 0; offset + 1 < data.byteLength; offset += 2) {
    if (data.readInt16LE(offset) !== 0) {
      return false;
    }
  }
  return true;
}
