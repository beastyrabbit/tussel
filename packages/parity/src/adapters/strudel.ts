import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ExternalFixtureSource, NormalizedEvent } from '../schema.js';

interface StrudelModules {
  Dough: new (
    sampleRate?: number,
    currentTime?: number,
  ) => {
    loadSample(name: string, channels: Float32Array[], sampleRate: number): void;
    out: [number, number];
    scheduleSpawn(value: Record<string, unknown>): void;
    update(): void;
  };
  core: {
    evalScope: (...args: unknown[]) => Promise<unknown>;
  };
  tonal: Record<string, unknown>;
  transpiler: {
    evaluate: (code: string) => Promise<{ pattern: ReferencePattern }>;
  };
  mini: Record<string, unknown>;
}

interface ReferencePattern {
  queryArc: (begin: number, end: number) => ReferenceHap[];
}

function isReferencePattern(value: unknown): value is ReferencePattern {
  return (
    value != null &&
    typeof value === 'object' &&
    'queryArc' in value &&
    typeof (value as ReferencePattern).queryArc === 'function'
  );
}

interface ReferenceHap {
  duration: number;
  hasOnset?: () => boolean;
  value: Record<string, unknown>;
  whole: {
    begin: number;
    end: number;
  };
}

let modulesPromise: Promise<StrudelModules> | undefined;

export async function queryStrudelEvents(
  code: string,
  options: {
    channel?: string;
    cps: number;
    durationCycles: number;
  },
): Promise<NormalizedEvent[]> {
  const pattern = await evaluatePattern(code);
  return pattern
    .queryArc(0, options.durationCycles)
    .map((hap) => normalizeReferenceHap(hap, options.channel))
    .sort(compareEvent);
}

export async function renderStrudelAudio(
  code: string,
  options: {
    cps: number;
    durationCycles: number;
    samplePack?: string;
  },
): Promise<Buffer> {
  const modules = await loadModules();
  const sampleRate = 48_000;
  const seconds = options.durationCycles / options.cps;
  const dough = new modules.Dough(sampleRate);
  if (options.samplePack) {
    await loadSamplePack(dough, options.samplePack);
  }

  const pattern = await evaluatePattern(code);
  for (const hap of pattern.queryArc(0, options.durationCycles)) {
    if (hap.hasOnset && !hap.hasOnset()) {
      continue;
    }
    const value = { ...hap.value };
    const sound = resolveReferenceSound(value);
    if (sound) {
      value.s = sound;
    } else {
      delete value.s;
    }
    value._begin = Number(hap.whole.begin) / options.cps;
    value._duration = Number(hap.duration) / options.cps;
    dough.scheduleSpawn(value);
  }

  const left = new Float32Array(Math.ceil(seconds * sampleRate));
  const right = new Float32Array(Math.ceil(seconds * sampleRate));
  for (let index = 0; index < left.length; index += 1) {
    dough.update();
    left[index] = dough.out[0];
    right[index] = dough.out[1];
  }
  return encodeWav(sampleRate, [left, right]);
}

export async function resolveStrudelSourceCode(source: ExternalFixtureSource): Promise<string> {
  if (source.code) {
    return source.code;
  }
  if (source.path) {
    return readFile(path.resolve(source.path), 'utf8');
  }
  throw new Error('Parity fixture source requires either code or path.');
}

async function evaluatePattern(code: string): Promise<ReferencePattern> {
  const modules = await loadModules();
  await resetScope(modules);
  const evaluated = await modules.transpiler.evaluate(code);
  if (isReferencePattern(evaluated.pattern)) {
    return evaluated.pattern;
  }
  // Some Strudel versions return the pattern as the top-level result
  if (isReferencePattern(evaluated)) {
    return evaluated;
  }
  throw new Error(`Strudel source did not evaluate to a pattern: ${code}`);
}

async function loadModules(): Promise<StrudelModules> {
  if (!modulesPromise) {
    modulesPromise = (async () => {
      const [core, mini, tonal, transpiler, dough] = await Promise.all([
        import(pathToFileURL(path.resolve('.ref/strudel/packages/core/index.mjs')).href),
        import(pathToFileURL(path.resolve('.ref/strudel/packages/mini/index.mjs')).href),
        import(pathToFileURL(path.resolve('.ref/strudel/packages/tonal/index.mjs')).href),
        import(pathToFileURL(path.resolve('.ref/strudel/packages/transpiler/index.mjs')).href),
        import(pathToFileURL(path.resolve('.ref/strudel/packages/supradough/dough.mjs')).href),
      ]);

      return {
        Dough: dough.Dough,
        core,
        mini,
        tonal,
        transpiler,
      } satisfies StrudelModules;
    })();
  }
  return modulesPromise;
}

async function resetScope(modules: StrudelModules): Promise<void> {
  await modules.core.evalScope(modules.core, modules.mini, modules.tonal, {
    samples: (value: unknown) => value,
    setbpm: (value: unknown) => value,
    setcps: (value: unknown) => value,
  });
}

async function loadSamplePack(
  dough: {
    loadSample(name: string, channels: Float32Array[], sampleRate: number): void;
  },
  samplePack: string,
): Promise<void> {
  const manifestPath = path.resolve(samplePack, 'strudel.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, string | string[]>;
  const base = typeof manifest._base === 'string' ? manifest._base : '.';
  for (const [key, value] of Object.entries(manifest)) {
    if (key === '_base') {
      continue;
    }
    const fileName = Array.isArray(value) ? value[0] : value;
    if (!fileName) {
      continue;
    }
    const decoded = decodePcm16Wav(await readFile(path.resolve(samplePack, base, fileName)));
    dough.loadSample(key, decoded.channels, decoded.sampleRate);
  }
}

function normalizeReferenceHap(hap: ReferenceHap, channelOverride?: string): NormalizedEvent {
  const payload = Object.fromEntries(
    Object.entries(hap.value)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [normalizePayloadKey(key), normalizeScalar(value)]),
  );
  return {
    begin: round(Number(hap.whole.begin)),
    channel: channelOverride ?? `${payload.p ?? 'd1'}`,
    duration: round(Number(hap.duration)),
    end: round(Number(hap.whole.end)),
    payload,
  };
}

function normalizeScalar(value: unknown): boolean | null | number | string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return round(value);
  }
  return `${value}`;
}

function normalizePayloadKey(key: string): string {
  if (key === 'cutoff') {
    return 'lpf';
  }
  if (key === 'hcutoff') {
    return 'hpf';
  }
  return key;
}

function resolveReferenceSound(value: Record<string, unknown>): string | undefined {
  const sound = typeof value.s === 'string' ? value.s.trim() : '';
  if (!sound) {
    return undefined;
  }
  const bank = typeof value.bank === 'string' && value.bank.length > 0 ? `${value.bank}_` : '';
  return `${bank}${sound}`;
}

function round(value: number): number {
  return Number(value.toFixed(9));
}

function compareEvent(left: NormalizedEvent, right: NormalizedEvent): number {
  return (
    left.begin - right.begin ||
    left.end - right.end ||
    left.channel.localeCompare(right.channel) ||
    JSON.stringify(left.payload).localeCompare(JSON.stringify(right.payload))
  );
}

function decodePcm16Wav(buffer: Buffer): {
  channels: Float32Array[];
  sampleRate: number;
} {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Expected RIFF/WAVE sample asset');
  }

  let channels = 0;
  let sampleRate = 0;
  let bitDepth = 0;
  let format = 0;
  let dataOffset = -1;
  let dataLength = 0;
  let offset = 12;

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkOffset = offset + 8;

    if (chunkId === 'fmt ') {
      format = buffer.readUInt16LE(chunkOffset);
      channels = buffer.readUInt16LE(chunkOffset + 2);
      sampleRate = buffer.readUInt32LE(chunkOffset + 4);
      bitDepth = buffer.readUInt16LE(chunkOffset + 14);
    } else if (chunkId === 'data') {
      dataOffset = chunkOffset;
      dataLength = chunkSize;
    }

    offset = chunkOffset + chunkSize + (chunkSize % 2);
  }

  if (format !== 1) {
    throw new Error(`Expected PCM sample asset, received format ${format}`);
  }
  const bytesPerSample = bitDepth / 8;
  if (bitDepth !== 16 && bitDepth !== 24) {
    throw new Error(`Expected PCM16/PCM24 sample asset, received ${bitDepth}-bit data`);
  }
  if (channels <= 0 || sampleRate <= 0 || dataOffset < 0) {
    throw new Error('Malformed WAV sample asset');
  }

  const frames = dataLength / (channels * bytesPerSample);
  const channelData = Array.from({ length: channels }, () => new Float32Array(frames));
  let cursor = dataOffset;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const data = channelData[channel];
      if (data) {
        data[frame] = readPcmSample(buffer, cursor, bitDepth);
      }
      cursor += bytesPerSample;
    }
  }
  return { channels: channelData, sampleRate };
}

function readPcmSample(buffer: Buffer, offset: number, bitDepth: number): number {
  if (bitDepth === 16) {
    return buffer.readInt16LE(offset) / 0x8000;
  }
  if (bitDepth === 24) {
    return buffer.readIntLE(offset, 3) / 0x800000;
  }
  throw new Error(`Unsupported PCM bit depth: ${bitDepth}`);
}

function encodeWav(sampleRate: number, channels: Float32Array[]): Buffer {
  const frames = channels[0]?.length ?? 0;
  const result = Buffer.alloc(frames * channels.length * 2 + 44);
  result.write('RIFF', 0, 'ascii');
  result.writeUInt32LE(result.byteLength - 8, 4);
  result.write('WAVE', 8, 'ascii');
  result.write('fmt ', 12, 'ascii');
  result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20);
  result.writeUInt16LE(channels.length, 22);
  result.writeUInt32LE(sampleRate, 24);
  result.writeUInt32LE(sampleRate * channels.length * 2, 28);
  result.writeUInt16LE(channels.length * 2, 32);
  result.writeUInt16LE(16, 34);
  result.write('data', 36, 'ascii');
  result.writeUInt32LE(result.byteLength - 44, 40);

  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels.length; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel]?.[frame] ?? 0));
      result.writeInt16LE(sample < 0 ? sample * 0x8000 : sample * 0x7fff, offset);
      offset += 2;
    }
  }
  return result;
}
