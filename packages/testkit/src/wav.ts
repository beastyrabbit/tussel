export interface WavLayout {
  channels: number;
  sampleRate: number;
  bitDepth: number;
  format: number;
  dataOffset: number;
  dataLength: number;
}

export interface DecodedWav {
  channels: Float32Array[];
  sampleRate: number;
}

/**
 * Walk the RIFF chunk list of a WAV buffer and return its layout.
 * Supports PCM formats (format 1) with 16- or 24-bit samples.
 */
export function inspectWav(buffer: Buffer): WavLayout {
  if (
    buffer.byteLength < 12 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('Expected RIFF/WAVE data');
  }
  const riffEnd = buffer.readUInt32LE(4) + 8;
  if (riffEnd > buffer.byteLength) {
    throw new Error('Malformed WAV data: RIFF length exceeds buffer');
  }

  let channels = 0;
  let sampleRate = 0;
  let bitDepth = 0;
  let format = 0;
  let dataOffset = -1;
  let dataLength = 0;
  let offset = 12;

  while (offset + 8 <= riffEnd) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkOffset = offset + 8;
    const chunkEnd = chunkOffset + chunkSize;
    if (chunkEnd > riffEnd || chunkEnd > buffer.byteLength) {
      throw new Error(`Malformed WAV data: ${JSON.stringify(chunkId)} chunk exceeds buffer`);
    }

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) {
        throw new Error('Malformed WAV data: "fmt " chunk is shorter than 16 bytes');
      }
      format = buffer.readUInt16LE(chunkOffset);
      channels = buffer.readUInt16LE(chunkOffset + 2);
      sampleRate = buffer.readUInt32LE(chunkOffset + 4);
      bitDepth = buffer.readUInt16LE(chunkOffset + 14);
    } else if (chunkId === 'data') {
      dataOffset = chunkOffset;
      dataLength = chunkSize;
    }

    const paddedChunkEnd = chunkEnd + (chunkSize % 2);
    if (paddedChunkEnd > riffEnd) {
      throw new Error(`Malformed WAV data: ${JSON.stringify(chunkId)} chunk padding exceeds buffer`);
    }
    offset = paddedChunkEnd;
  }

  if (channels <= 0 || sampleRate <= 0 || dataOffset < 0) {
    throw new Error('Malformed WAV data');
  }

  return { bitDepth, channels, dataLength, dataOffset, format, sampleRate };
}

/** Read a single PCM16/PCM24 sample as a normalized float in [-1, 1]. */
export function readPcmSample(buffer: Buffer, offset: number, bitDepth: number): number {
  const bytesPerSample = bitDepth / 8;
  if (!Number.isInteger(offset) || offset < 0 || offset + bytesPerSample > buffer.byteLength) {
    throw new Error('Malformed PCM data: sample exceeds buffer');
  }
  if (bitDepth === 16) {
    return buffer.readInt16LE(offset) / 0x8000;
  }
  if (bitDepth === 24) {
    return buffer.readIntLE(offset, 3) / 0x800000;
  }
  throw new Error(`Unsupported PCM bit depth: ${bitDepth}`);
}

/** Decode a PCM16/PCM24 WAV buffer into per-channel Float32 data. */
export function decodePcmWav(buffer: Buffer): DecodedWav {
  const layout = inspectWav(buffer);
  if (layout.format !== 1) {
    throw new Error(`Expected PCM WAV data, received format ${layout.format}`);
  }
  if (layout.bitDepth !== 16 && layout.bitDepth !== 24) {
    throw new Error(`Expected PCM16/PCM24 WAV data, received ${layout.bitDepth}-bit data`);
  }

  const bytesPerSample = layout.bitDepth / 8;
  const bytesPerFrame = layout.channels * bytesPerSample;
  if (layout.dataLength % bytesPerFrame !== 0) {
    throw new Error('Malformed PCM WAV data: data chunk does not contain whole frames');
  }
  const frames = layout.dataLength / bytesPerFrame;
  const channelData = Array.from({ length: layout.channels }, () => new Float32Array(frames));
  let cursor = layout.dataOffset;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < layout.channels; channel += 1) {
      const data = channelData[channel];
      if (data) {
        data[frame] = readPcmSample(buffer, cursor, layout.bitDepth);
      }
      cursor += bytesPerSample;
    }
  }
  return { channels: channelData, sampleRate: layout.sampleRate };
}

const CANONICAL_HEADER_LENGTH = 44;

function writeWavHeader(buffer: Buffer, sampleRate: number, channels: number, dataLength: number): void {
  const totalLength = CANONICAL_HEADER_LENGTH + dataLength;
  // ASCII field identifiers must land byte-exact; numeric fields are little-endian.
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(totalLength - 8, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataLength, 40);
}

/** Encode interleaved PCM16 data (already in WAV byte order) into a canonical WAV buffer. */
export function encodeCanonicalWav(sampleRate: number, channels: number, pcmData: Buffer): Buffer {
  assertWavEncodingLayout(sampleRate, channels);
  if (pcmData.byteLength % (channels * 2) !== 0) {
    throw new Error('PCM16 data must contain whole interleaved frames');
  }
  const result = Buffer.alloc(CANONICAL_HEADER_LENGTH + pcmData.byteLength);
  writeWavHeader(result, sampleRate, channels, pcmData.byteLength);
  pcmData.copy(result, CANONICAL_HEADER_LENGTH);
  return result;
}

/** Encode per-channel Float32 data (normalized [-1, 1]) into a canonical PCM16 WAV buffer. */
export function encodeWavFromFloat32Channels(sampleRate: number, channels: Float32Array[]): Buffer {
  assertWavEncodingLayout(sampleRate, channels.length);
  const frames = channels[0]?.length ?? 0;
  if (channels.some((channel) => channel.length !== frames)) {
    throw new Error('WAV channels must contain the same number of frames');
  }
  const result = encodeCanonicalWav(sampleRate, channels.length, Buffer.alloc(frames * channels.length * 2));
  let offset = CANONICAL_HEADER_LENGTH;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels.length; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel]?.[frame] ?? 0));
      result.writeInt16LE(sample < 0 ? sample * 0x8000 : sample * 0x7fff, offset);
      offset += 2;
    }
  }
  return result;
}

export interface ParsedCanonicalWav {
  channels: number;
  /** Raw interleaved PCM16 payload (header stripped). */
  data: Buffer;
  sampleRate: number;
}

/**
 * Parse a canonical 44-byte-header WAV buffer, returning the raw payload
 * without validating rate/channel/bit-depth assumptions.
 */
export function parseCanonicalWav(buffer: Buffer): ParsedCanonicalWav {
  if (buffer.byteLength < CANONICAL_HEADER_LENGTH) {
    throw new Error('Expected canonical RIFF/WAVE data');
  }
  const header = buffer.subarray(0, CANONICAL_HEADER_LENGTH);
  if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Expected canonical RIFF/WAVE data');
  }
  if (
    header.toString('ascii', 12, 16) !== 'fmt ' ||
    header.readUInt32LE(16) !== 16 ||
    header.toString('ascii', 36, 40) !== 'data'
  ) {
    throw new Error('Expected canonical 44-byte RIFF/WAVE header');
  }
  const dataLength = header.readUInt32LE(40);
  if (
    header.readUInt32LE(4) + 8 !== buffer.byteLength ||
    dataLength + CANONICAL_HEADER_LENGTH !== buffer.byteLength
  ) {
    throw new Error('Malformed canonical RIFF/WAVE length');
  }
  return {
    channels: header.readUInt16LE(22),
    data: buffer.subarray(CANONICAL_HEADER_LENGTH, CANONICAL_HEADER_LENGTH + dataLength),
    sampleRate: header.readUInt32LE(24),
  };
}

function assertWavEncodingLayout(sampleRate: number, channels: number): void {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 0xffff_ffff) {
    throw new Error('WAV sample rate must be a positive 32-bit integer');
  }
  if (!Number.isInteger(channels) || channels <= 0 || channels > 0xffff) {
    throw new Error('WAV channel count must be a positive 16-bit integer');
  }
  const blockAlign = channels * 2;
  if (blockAlign > 0xffff || sampleRate * blockAlign > 0xffff_ffff) {
    throw new Error('WAV PCM16 byte rate exceeds canonical header limits');
  }
}
