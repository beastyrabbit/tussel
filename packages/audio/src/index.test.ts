import path from 'node:path';
import { defineScene, loadCsound, note, resetCsoundRegistry, s } from '@tussel/dsl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderSceneToWavBuffer, resolveCsoundVoiceSpec } from './index.js';

const BASIC_KIT = path.resolve('reference', 'assets', 'basic-kit');

afterEach(() => {
  vi.restoreAllMocks();
  resetCsoundRegistry();
});

describe('audio engine defaults', () => {
  it('renders note-only scenes with an audible default synth', async () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: note('a3 c#4 e4 a4'),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const wav = await renderSceneToWavBuffer(scene, { seconds: 2 });
    expect(maxSampleMagnitude(wav)).toBeGreaterThan(0);
  });

  it('adds an audible delay tail after the dry note window', async () => {
    const dry = await renderSceneToWavBuffer(createImpulseScene(), { seconds: 1 });
    const delayed = await renderSceneToWavBuffer(createImpulseScene({ delay: 0.8 }), { seconds: 1 });

    expect(rmsWindow(delayed, 0.35, 0.85)).toBeGreaterThan(rmsWindow(dry, 0.35, 0.85) * 3);
  });

  it('extends the tail when room and size are enabled', async () => {
    const smallRoom = await renderSceneToWavBuffer(createImpulseScene({ room: 1, size: 0.2 }), {
      seconds: 1,
    });
    const largeRoom = await renderSceneToWavBuffer(createImpulseScene({ room: 1, size: 4 }), { seconds: 1 });

    expect(rmsWindow(largeRoom, 0.6, 0.95)).toBeGreaterThan(rmsWindow(smallRoom, 0.6, 0.95) * 1.5);
  });

  it('changes filtered noise output when lpq resonance changes', async () => {
    const lowQ = await renderSceneToWavBuffer(createNoiseScene({ lpf: 800, lpq: 0.5 }), { seconds: 1 });
    const highQ = await renderSceneToWavBuffer(createNoiseScene({ lpf: 800, lpq: 18 }), { seconds: 1 });

    expect(pcmData(highQ).equals(pcmData(lowQ))).toBe(false);
    expect(maxAbsoluteDelta(lowQ, highQ)).toBeGreaterThan(100);
  });

  it('applies an audible phaser effect', async () => {
    const dry = await renderSceneToWavBuffer(createSynthScene(), { seconds: 1 });
    const phased = await renderSceneToWavBuffer(createSynthScene({ phaser: 1.5 }), { seconds: 1 });

    expect(pcmData(phased).equals(pcmData(dry))).toBe(false);
    expect(maxAbsoluteDelta(dry, phased)).toBeGreaterThan(100);
  });

  it('applies fm synthesis to pitched voices', async () => {
    const dry = await renderSceneToWavBuffer(createSynthScene({ fm: 0 }), { seconds: 1 });
    const modulated = await renderSceneToWavBuffer(createSynthScene({ fm: 2 }), { seconds: 1 });

    expect(pcmData(modulated).equals(pcmData(dry))).toBe(false);
    expect(maxAbsoluteDelta(dry, modulated)).toBeGreaterThan(100);
  });

  it('renders csound-tagged voices with audible output', async () => {
    await loadCsound`instr CoolSynth
endin`;

    const wav = await renderSceneToWavBuffer(createCsoundScene('CoolSynth'), { seconds: 1 });

    expect(maxSampleMagnitude(wav)).toBeGreaterThan(0);
  });

  it('renders different csound instruments with distinct output', async () => {
    await loadCsound`instr FM1
endin

instr Organ1
endin`;

    const fm = await renderSceneToWavBuffer(createCsoundScene('FM1'), { seconds: 1 });
    const organ = await renderSceneToWavBuffer(createCsoundScene('Organ1'), { seconds: 1 });

    expect(pcmData(fm).equals(pcmData(organ))).toBe(false);
    expect(maxAbsoluteDelta(fm, organ)).toBeGreaterThan(100);
  });

  it('derives csound p-fields from note, gain, and duration semantics', () => {
    const hzSpec = resolveCsoundVoiceSpec(
      {
        begin: 0,
        channel: 'lead',
        duration: 0.5,
        end: 0.5,
        payload: { csound: 'CoolSynth', gain: 0.4, note: 'A4' },
      },
      1,
    );
    const midiSpec = resolveCsoundVoiceSpec(
      {
        begin: 0,
        channel: 'lead',
        duration: 0.5,
        end: 0.5,
        payload: { csoundm: 'CoolSynth', gain: 0.5, note: 'A4', velocity: 0.8 },
      },
      1,
    );

    expect(hzSpec).toMatchObject({
      duration: 0.5,
      gain: 0.4,
      instrument: 'CoolSynth',
      mode: 'frequency',
    });
    expect(hzSpec?.frequency).toBeCloseTo(440, 0);
    expect(midiSpec?.mode).toBe('midi');
    expect(midiSpec?.midiKey).toBeCloseTo(69, 3);
    expect(midiSpec?.velocity).toBeCloseTo(50.8, 3);
  });

  it('warns for unknown csound instruments instead of failing silently', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await renderSceneToWavBuffer(createCsoundScene('MissingInstrument'), { seconds: 1 });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown csound instrument: MissingInstrument'),
    );
  });

  it('applies an audible waveshaping distortion', async () => {
    const dry = await renderSceneToWavBuffer(createSynthScene({ shape: 0 }), { seconds: 1 });
    const shaped = await renderSceneToWavBuffer(createSynthScene({ shape: 0.8 }), { seconds: 1 });

    expect(pcmData(shaped).equals(pcmData(dry))).toBe(false);
    expect(maxAbsoluteDelta(dry, shaped)).toBeGreaterThan(100);
  });

  it('renders stereo noise with non-identical channels', async () => {
    const noise = await renderSceneToWavBuffer(createNoiseScene(), { seconds: 1 });
    expect(channelDifferenceRms(noise, 0, 0.5)).toBeGreaterThan(0.005);
  });

  it('supports reverse sample playback from negative speed values', async () => {
    const forward = await renderSceneToWavBuffer(createSampleScene({ speed: 1 }), { seconds: 1 });
    const reversed = await renderSceneToWavBuffer(createSampleScene({ speed: -1 }), { seconds: 1 });

    expect(pcmData(reversed).equals(pcmData(forward))).toBe(false);
    expect(maxAbsoluteDelta(forward, reversed)).toBeGreaterThan(500);
  });

  it('keeps higher sample speeds distinct instead of clamping them together', async () => {
    const fast = await renderSceneToWavBuffer(createSampleScene({ speed: 4 }), { seconds: 1 });
    const faster = await renderSceneToWavBuffer(createSampleScene({ speed: 8 }), { seconds: 1 });

    expect(pcmData(faster).equals(pcmData(fast))).toBe(false);
    expect(maxAbsoluteDelta(fast, faster)).toBeGreaterThan(100);
  });

  it('keeps looped samples audible after the original sample tail', async () => {
    const dry = await renderSceneToWavBuffer(createSampleScene(), { seconds: 1 });
    const looped = await renderSceneToWavBuffer(createSampleScene({ loop: true }), { seconds: 1 });

    expect(rmsWindow(looped, 0.65, 0.95)).toBeGreaterThan(rmsWindow(dry, 0.65, 0.95) * 2);
  });

  it('cuts overlapping sample tails within the same cut group during offline renders', async () => {
    const overlapping = await renderSceneToWavBuffer(createCutGroupScene(false), { seconds: 1 });
    const cut = await renderSceneToWavBuffer(createCutGroupScene(true), { seconds: 1 });

    expect(pcmData(cut).equals(pcmData(overlapping))).toBe(false);
    expect(rmsWindow(cut, 0.75, 0.95)).toBeLessThan(rmsWindow(overlapping, 0.75, 0.95) * 0.98);
  });

  it('applies scene.master.gain on the shared mix bus', async () => {
    const unity = await renderSceneToWavBuffer(createSampleScene({ gain: 1 }), { seconds: 1 });
    const quiet = await renderSceneToWavBuffer(createSampleScene({ gain: 1 }, { gain: 0.2 }), {
      seconds: 1,
    });

    expect(maxSampleMagnitude(quiet)).toBeLessThan(maxSampleMagnitude(unity) * 0.5);
  });

  it('routes orbit channels through the shared master effects bus', async () => {
    const dry = await renderSceneToWavBuffer(createOrbitSampleScene(), { seconds: 1 });
    const wet = await renderSceneToWavBuffer(createOrbitSampleScene({ room: 1, size: 2 }), { seconds: 1 });

    expect(rmsWindow(wet, 0.55, 0.95)).toBeGreaterThan(rmsWindow(dry, 0.55, 0.95) * 2);
  });

  it('rejects invalid offline render durations', async () => {
    await expect(renderSceneToWavBuffer(createSampleScene(), { seconds: 0 })).rejects.toThrow(
      'renderSceneToWavBuffer() requires seconds > 0',
    );
    await expect(renderSceneToWavBuffer(createSampleScene(), { sampleRate: 0, seconds: 1 })).rejects.toThrow(
      'renderSceneToWavBuffer() requires sampleRate > 0',
    );
  });
});

function createImpulseScene(
  effects: Partial<{
    delay: number | string;
    room: number;
    size: number;
  }> = {},
) {
  let node = note('69 ~ ~ ~').s('sine').attack(0.001).decay(0.01).sustain(0).release(0.01).gain(0.15);
  if (effects.delay !== undefined) {
    node = node.delay(effects.delay);
  }
  if (effects.room !== undefined) {
    node = node.room(effects.room);
  }
  if (effects.size !== undefined) {
    node = node.size(effects.size);
  }
  return defineScene({
    channels: {
      lead: {
        node,
      },
    },
    samples: [],
    transport: { cps: 1 },
  });
}

function createNoiseScene(
  effects: Partial<{
    lpf: number;
    lpq: number;
  }> = {},
) {
  let node = s('noise').fast(8).attack(0.001).decay(0.02).sustain(0).release(0.01).gain(0.2);
  if (effects.lpf !== undefined) {
    node = node.lpf(effects.lpf);
  }
  if (effects.lpq !== undefined) {
    node = node.lpq(effects.lpq);
  }
  return defineScene({
    channels: {
      noise: {
        node,
      },
    },
    samples: [],
    transport: { cps: 1 },
  });
}

function createSynthScene(
  effects: Partial<{
    fm: number;
    phaser: number;
    shape: number;
  }> = {},
) {
  let node = note('69').s('saw').attack(0.001).decay(0.02).sustain(0.8).release(0.05).gain(0.15);
  if (effects.fm !== undefined) {
    node = node.fm(effects.fm);
  }
  if (effects.phaser !== undefined) {
    node = node.phaser(effects.phaser);
  }
  if (effects.shape !== undefined) {
    node = node.shape(effects.shape);
  }
  return defineScene({
    channels: {
      lead: {
        node,
      },
    },
    samples: [],
    transport: { cps: 1 },
  });
}

function createCsoundScene(instrument: string, mode: 'csound' | 'csoundm' = 'csound') {
  let node = note('a4 c5').gain(0.35);
  node = mode === 'csound' ? node.csound(instrument) : node.csoundm(instrument);
  return defineScene({
    channels: {
      lead: {
        node,
      },
    },
    samples: [],
    transport: { cps: 1 },
  });
}

function createCutGroupScene(withCut: boolean) {
  let node = s('bd bd').fast(2).loop(true).gain(0.8);
  if (withCut) {
    node = node.cut(1);
  }
  return defineScene({
    channels: {
      drums: {
        node,
      },
    },
    samples: [{ ref: BASIC_KIT }],
    transport: { cps: 1 },
  });
}

function createSampleScene(
  playback: Partial<{
    gain: number;
    loop: boolean;
    speed: number;
  }> = {},
  master: Partial<{
    gain: number;
  }> = {},
) {
  let node = s('bd').gain(playback.gain ?? 0.8);
  if (playback.speed !== undefined) {
    node = node.speed(playback.speed);
  }
  if (playback.loop !== undefined) {
    node = node.loop(playback.loop);
  }
  return defineScene({
    channels: {
      drums: {
        node,
      },
    },
    master,
    samples: [{ ref: BASIC_KIT }],
    transport: { cps: 1 },
  });
}

function createOrbitSampleScene(
  master: Partial<{
    room: number;
    size: number;
  }> = {},
) {
  return defineScene({
    channels: {
      drums: {
        node: s('bd').orbit('fx').gain(0.8),
      },
    },
    master,
    samples: [{ ref: BASIC_KIT }],
    transport: { cps: 1 },
  });
}

function maxSampleMagnitude(wav: Buffer): number {
  let max = 0;
  for (let offset = 44; offset + 1 < wav.byteLength; offset += 2) {
    max = Math.max(max, Math.abs(wav.readInt16LE(offset)));
  }
  return max;
}

function pcmData(wav: Buffer): Buffer {
  return wav.subarray(44);
}

function rmsWindow(wav: Buffer, startSeconds: number, endSeconds: number): number {
  const { left, right, sampleRate } = decodeStereo(wav);
  const start = Math.max(0, Math.floor(startSeconds * sampleRate));
  const end = Math.min(left.length, Math.ceil(endSeconds * sampleRate));
  let sumSquares = 0;
  let count = 0;
  for (let index = start; index < end; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    sumSquares += l * l + r * r;
    count += 2;
  }
  return count === 0 ? 0 : Math.sqrt(sumSquares / count);
}

function channelDifferenceRms(wav: Buffer, startSeconds: number, endSeconds: number): number {
  const { left, right, sampleRate } = decodeStereo(wav);
  const start = Math.max(0, Math.floor(startSeconds * sampleRate));
  const end = Math.min(left.length, Math.ceil(endSeconds * sampleRate));
  let sumSquares = 0;
  let count = 0;
  for (let index = start; index < end; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    sumSquares += delta * delta;
    count += 1;
  }
  return count === 0 ? 0 : Math.sqrt(sumSquares / count);
}

function maxAbsoluteDelta(leftWav: Buffer, rightWav: Buffer): number {
  const left = pcmData(leftWav);
  const right = pcmData(rightWav);
  const length = Math.min(left.byteLength, right.byteLength);
  let max = 0;
  for (let offset = 0; offset + 1 < length; offset += 2) {
    max = Math.max(max, Math.abs(left.readInt16LE(offset) - right.readInt16LE(offset)));
  }
  return max;
}

function decodeStereo(wav: Buffer): { left: Float32Array; right: Float32Array; sampleRate: number } {
  const channels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const bitsPerSample = wav.readUInt16LE(34);
  if (channels !== 2 || bitsPerSample !== 16) {
    throw new Error(`Expected stereo PCM16 wav, received ${channels} channels and ${bitsPerSample} bits`);
  }
  const frameCount = (wav.byteLength - 44) / 4;
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  let offset = 44;
  for (let index = 0; index < frameCount; index += 1) {
    left[index] = wav.readInt16LE(offset) / 0x8000;
    right[index] = wav.readInt16LE(offset + 2) / 0x8000;
    offset += 4;
  }
  return { left, right, sampleRate };
}
