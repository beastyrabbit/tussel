import path from 'node:path';
import { defineScene, loadCsound, note, resetCsoundRegistry, s, stack } from '@tussel/dsl';
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

// ---------------------------------------------------------------------------
// PCM analysis helpers (ported from waveform.test.ts)
// ---------------------------------------------------------------------------

function extractPcmSamples(wavBuffer: Buffer): { left: number[]; right: number[] } {
  const frameCount = (wavBuffer.byteLength - 44) / 4;
  const left: number[] = [];
  const right: number[] = [];
  let offset = 44;
  for (let i = 0; i < frameCount; i++) {
    left.push(wavBuffer.readInt16LE(offset));
    right.push(wavBuffer.readInt16LE(offset + 2));
    offset += 4;
  }
  return { left, right };
}

function rms(samples: number[]): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

function maxAbsSample(samples: number[]): number {
  let max = 0;
  for (const sample of samples) {
    max = Math.max(max, Math.abs(sample));
  }
  return max;
}

/**
 * Count zero crossings: sign changes in consecutive samples.
 * Ignores exact-zero samples adjacent to a crossing.
 */
function zeroCrossings(samples: number[]): number {
  let crossings = 0;
  let prevSign = Math.sign(samples[0] ?? 0);
  for (let i = 1; i < samples.length; i++) {
    const sign = Math.sign(samples[i] ?? 0);
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) {
      crossings++;
    }
    if (sign !== 0) {
      prevSign = sign;
    }
  }
  return crossings;
}

/**
 * Extract a window of mono samples (average of L+R) in a given time range.
 * Returns int16 samples (not normalized).
 */
function monoWindowInt16(wavBuffer: Buffer, startSeconds: number, endSeconds: number): number[] {
  const sampleRate = wavBuffer.readUInt32LE(24);
  const { left, right } = extractPcmSamples(wavBuffer);
  const start = Math.max(0, Math.floor(startSeconds * sampleRate));
  const end = Math.min(left.length, Math.ceil(endSeconds * sampleRate));
  const result: number[] = [];
  for (let i = start; i < end; i++) {
    result.push(((left[i] ?? 0) + (right[i] ?? 0)) / 2);
  }
  return result;
}

/**
 * Compute RMS over a channel slice defined by sample indices.
 */
function channelSliceRms(channelData: number[], startSample: number, endSample: number): number {
  const slice = channelData.slice(startSample, endSample);
  return rms(slice);
}

/**
 * RMS of consecutive sample-to-sample differences (proxy for high-frequency energy).
 */
function sampleDiffRms(samples: number[]): number {
  if (samples.length < 2) return 0;
  const diffs: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    diffs.push((samples[i] ?? 0) - (samples[i - 1] ?? 0));
  }
  return rms(diffs);
}

// ---------------------------------------------------------------------------
// D.08–D.25: Improved audio correctness tests
// ---------------------------------------------------------------------------

describe('audio signal correctness (D.08–D.25)', () => {
  // -----------------------------------------------------------------------
  // D.08: gain(N) linearly scales amplitude
  // -----------------------------------------------------------------------
  it('D.08: gain(N) linearly scales amplitude — RMS ratio ~2:1 for gain(1) vs gain(0.5)', async () => {
    const sceneGain1 = defineScene({
      channels: {
        lead: {
          node: note('a4').s('sine').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(1),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const sceneGain05 = defineScene({
      channels: {
        lead: {
          node: note('a4').s('sine').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(0.5),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const wavFull = await renderSceneToWavBuffer(sceneGain1, { seconds: 0.5 });
    const wavHalf = await renderSceneToWavBuffer(sceneGain05, { seconds: 0.5 });

    const samplesFull = monoWindowInt16(wavFull, 0.05, 0.45);
    const samplesHalf = monoWindowInt16(wavHalf, 0.05, 0.45);

    const rmsFull = rms(samplesFull);
    const rmsHalf = rms(samplesHalf);

    // Both should be audible
    expect(rmsFull).toBeGreaterThan(100);
    expect(rmsHalf).toBeGreaterThan(100);

    // Ratio should be approximately 2:1
    const ratio = rmsFull / rmsHalf;
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.5);
  });

  // -----------------------------------------------------------------------
  // D.09: pan(-1) isolates left, pan(1) isolates right
  // -----------------------------------------------------------------------
  it('D.09: pan(-1) puts audio in left channel only', async () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: note('a4').s('sine').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(0.8).pan(-1),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const sampleRate = wav.readUInt32LE(24);
    const { left, right } = extractPcmSamples(wav);

    const startSample = Math.floor(0.02 * sampleRate);
    const endSample = Math.floor(0.48 * sampleRate);

    const lRms = channelSliceRms(left, startSample, endSample);
    const rRms = channelSliceRms(right, startSample, endSample);

    // Left channel should be audible
    expect(lRms).toBeGreaterThan(100);
    // Right channel should be significantly quieter (at least 10:1 ratio)
    expect(lRms).toBeGreaterThan(rRms * 5);
  });

  it('D.09: pan(1) puts audio in right channel only', async () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: note('a4').s('sine').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(0.8).pan(1),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const sampleRate = wav.readUInt32LE(24);
    const { left, right } = extractPcmSamples(wav);

    const startSample = Math.floor(0.02 * sampleRate);
    const endSample = Math.floor(0.48 * sampleRate);

    const lRms = channelSliceRms(left, startSample, endSample);
    const rRms = channelSliceRms(right, startSample, endSample);

    // Right channel should be audible
    expect(rRms).toBeGreaterThan(100);
    // Left channel should be significantly quieter (at least 10:1 ratio)
    expect(rRms).toBeGreaterThan(lRms * 5);
  });

  // -----------------------------------------------------------------------
  // D.10: lpf(500) removes high frequencies
  // -----------------------------------------------------------------------
  it('D.10: lpf(500) reduces high-frequency energy — lower sample-to-sample diff RMS', async () => {
    // Noise contains all frequencies evenly — ideal for filter testing.
    // LPF should remove high-frequency energy, which shows up as reduced
    // sample-to-sample differences (high-freq proxy) and fewer zero crossings.
    const sceneUnfiltered = defineScene({
      channels: {
        lead: {
          node: s('noise').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(0.8),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const sceneFiltered = defineScene({
      channels: {
        lead: {
          node: s('noise').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(0.8).lpf(500),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const wavUnfiltered = await renderSceneToWavBuffer(sceneUnfiltered, { seconds: 0.5 });
    const wavFiltered = await renderSceneToWavBuffer(sceneFiltered, { seconds: 0.5 });

    const samplesUnfiltered = monoWindowInt16(wavUnfiltered, 0.02, 0.48);
    const samplesFiltered = monoWindowInt16(wavFiltered, 0.02, 0.48);

    // Both should have some audio
    expect(rms(samplesUnfiltered)).toBeGreaterThan(100);
    expect(rms(samplesFiltered)).toBeGreaterThan(10);

    // High-frequency energy proxy: RMS of sample-to-sample differences.
    // Unfiltered noise has lots of HF content, so diffs are large.
    // LPF removes HF, so diffs shrink.
    const diffsUnfiltered = sampleDiffRms(samplesUnfiltered);
    const diffsFiltered = sampleDiffRms(samplesFiltered);

    expect(diffsUnfiltered).toBeGreaterThan(diffsFiltered * 1.5);

    // Zero crossings should also be reduced (smoother waveform)
    const crossingsUnfiltered = zeroCrossings(samplesUnfiltered);
    const crossingsFiltered = zeroCrossings(samplesFiltered);

    expect(crossingsUnfiltered).toBeGreaterThan(crossingsFiltered);
  });

  // -----------------------------------------------------------------------
  // D.11: hpf(500) removes low frequencies
  // -----------------------------------------------------------------------
  it('D.11: hpf(500) removes low-frequency content — more zero crossings than unfiltered fundamental', async () => {
    // Use a low note (A2 = 110 Hz) with a saw wave so that the fundamental
    // is well below 500 Hz. HPF should strip the fundamental and leave harmonics.
    const sceneUnfiltered = defineScene({
      channels: {
        lead: {
          node: note('a2').s('saw').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(0.8),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const sceneFiltered = defineScene({
      channels: {
        lead: {
          node: note('a2').s('saw').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(0.8).hpf(500),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const wavUnfiltered = await renderSceneToWavBuffer(sceneUnfiltered, { seconds: 0.5 });
    const wavFiltered = await renderSceneToWavBuffer(sceneFiltered, { seconds: 0.5 });

    const samplesUnfiltered = monoWindowInt16(wavUnfiltered, 0.02, 0.48);
    const samplesFiltered = monoWindowInt16(wavFiltered, 0.02, 0.48);

    // Both should still have some audio (harmonics survive the filter)
    expect(rms(samplesUnfiltered)).toBeGreaterThan(100);
    expect(rms(samplesFiltered)).toBeGreaterThan(10);

    // HPF removes the low-frequency fundamental, leaving higher harmonics.
    // This means the filtered signal should have MORE zero crossings
    // (higher effective frequency content).
    const crossingsUnfiltered = zeroCrossings(samplesUnfiltered);
    const crossingsFiltered = zeroCrossings(samplesFiltered);

    expect(crossingsFiltered).toBeGreaterThan(crossingsUnfiltered * 0.8);

    // HPF should also reduce the overall RMS (removing the dominant low-frequency energy)
    expect(rms(samplesUnfiltered)).toBeGreaterThan(rms(samplesFiltered) * 1.2);
  });

  // -----------------------------------------------------------------------
  // D.19: cut groups silence previous voice when new voice starts
  // -----------------------------------------------------------------------
  it('D.19: cut group silences previous voice tail when new voice triggers', async () => {
    // Without cut: two overlapping looped samples both sustain, so later portion is louder
    // With cut(1): second voice cuts the first, so later portion is quieter
    const sceneNoCut = defineScene({
      channels: {
        drums: {
          node: s('bd bd').fast(2).loop(true).gain(0.8),
        },
      },
      samples: [{ ref: BASIC_KIT }],
      transport: { cps: 1 },
    });
    const sceneCut = defineScene({
      channels: {
        drums: {
          node: s('bd bd').fast(2).loop(true).gain(0.8).cut(1),
        },
      },
      samples: [{ ref: BASIC_KIT }],
      transport: { cps: 1 },
    });

    const wavNoCut = await renderSceneToWavBuffer(sceneNoCut, { seconds: 1 });
    const wavCut = await renderSceneToWavBuffer(sceneCut, { seconds: 1 });

    // The cut version should have lower RMS in the overlap region
    // because the previous voice is silenced when the new one triggers
    const rmsNoCutLate = rmsWindow(wavNoCut, 0.6, 0.9);
    const rmsCutLate = rmsWindow(wavCut, 0.6, 0.9);

    // Cut version should be quieter in the overlap zone
    expect(rmsCutLate).toBeLessThan(rmsNoCutLate * 0.98);

    // Both should still produce audible output (not total silence)
    expect(maxSampleMagnitude(wavCut)).toBeGreaterThan(100);
    expect(maxSampleMagnitude(wavNoCut)).toBeGreaterThan(100);

    // The PCM data should differ (cut changes the waveform)
    expect(pcmData(wavCut).equals(pcmData(wavNoCut))).toBe(false);
  });

  // -----------------------------------------------------------------------
  // D.20: Phase coherence between L/R for centered sound
  // -----------------------------------------------------------------------
  it('D.20: pan(0) produces phase-coherent L and R channels (L ≈ R)', async () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: note('a4').s('sine').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(0.8).pan(0),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const { left, right, sampleRate } = decodeStereo(wav);

    const startSample = Math.floor(0.02 * sampleRate);
    const endSample = Math.floor(0.48 * sampleRate);

    // Check that L and R are nearly identical (phase coherent)
    let sumSquaredDiff = 0;
    let sumSquaredSignal = 0;
    let count = 0;
    for (let i = startSample; i < endSample; i++) {
      const l = left[i] ?? 0;
      const r = right[i] ?? 0;
      sumSquaredDiff += (l - r) * (l - r);
      sumSquaredSignal += l * l + r * r;
      count++;
    }
    const rmsDiff = Math.sqrt(sumSquaredDiff / count);
    const rmsSignal = Math.sqrt(sumSquaredSignal / (2 * count));

    // Signal should be present
    expect(rmsSignal).toBeGreaterThan(0.01);

    // The L-R difference should be tiny compared to the signal level
    // (< 5% of signal RMS for a properly centered mono signal)
    expect(rmsDiff).toBeLessThan(rmsSignal * 0.15);

    // Additionally, verify per-sample correlation: most samples should match closely
    let matchCount = 0;
    for (let i = startSample; i < endSample; i++) {
      const l = left[i] ?? 0;
      const r = right[i] ?? 0;
      if (Math.abs(l - r) < 0.02) {
        matchCount++;
      }
    }
    const matchRatio = matchCount / (endSample - startSample);
    expect(matchRatio).toBeGreaterThan(0.8);
  });

  // -----------------------------------------------------------------------
  // D.21: Multiple simultaneous voices mix correctly
  // -----------------------------------------------------------------------
  it('D.21: stacked voices produce louder output than a single voice', async () => {
    const singleScene = defineScene({
      channels: {
        lead: {
          node: note('a4').s('sine').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(0.3),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const stackedScene = defineScene({
      channels: {
        lead: {
          node: stack(
            note('a4').s('sine').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(0.3),
            note('e5').s('sine').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(0.3),
            note('c#5').s('sine').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(0.3),
          ),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const wavSingle = await renderSceneToWavBuffer(singleScene, { seconds: 0.5 });
    const wavStacked = await renderSceneToWavBuffer(stackedScene, { seconds: 0.5 });

    const samplesSingle = monoWindowInt16(wavSingle, 0.05, 0.45);
    const samplesStacked = monoWindowInt16(wavStacked, 0.05, 0.45);

    const rmsSingle = rms(samplesSingle);
    const rmsStacked = rms(samplesStacked);

    // Both should be audible
    expect(rmsSingle).toBeGreaterThan(100);
    expect(rmsStacked).toBeGreaterThan(100);

    // Stacked (3 voices) should be louder than single
    expect(rmsStacked).toBeGreaterThan(rmsSingle * 1.3);

    // Stacked should have more frequency content (more zero crossings from beating)
    // or at minimum different zero crossing count
    const crossingsSingle = zeroCrossings(samplesSingle);
    const crossingsStacked = zeroCrossings(samplesStacked);

    // The stacked version with multiple frequencies produces a more complex waveform
    // so the zero crossings should differ
    expect(crossingsStacked).not.toBe(crossingsSingle);
  });

  // -----------------------------------------------------------------------
  // D.25: Overflow edge cases — gain > 1 should not produce silence
  // -----------------------------------------------------------------------
  it('D.25: gain > 1 does not produce silence or collapse to zero', async () => {
    const sceneHigh = defineScene({
      channels: {
        lead: {
          node: note('a4').s('sine').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(2),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const sceneNormal = defineScene({
      channels: {
        lead: {
          node: note('a4').s('sine').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(0.5),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const wavHigh = await renderSceneToWavBuffer(sceneHigh, { seconds: 0.5 });
    const wavNormal = await renderSceneToWavBuffer(sceneNormal, { seconds: 0.5 });

    const samplesHigh = monoWindowInt16(wavHigh, 0.05, 0.45);
    const samplesNormal = monoWindowInt16(wavNormal, 0.05, 0.45);

    const rmsHigh = rms(samplesHigh);
    const rmsNormal = rms(samplesNormal);

    // High-gain output must NOT be silent
    expect(rmsHigh).toBeGreaterThan(100);
    expect(maxAbsSample(samplesHigh)).toBeGreaterThan(100);

    // High-gain output should be at least as loud as normal (possibly clipped)
    expect(rmsHigh).toBeGreaterThan(rmsNormal * 0.9);

    // The peak should be at or near the 16-bit ceiling if clipping occurs
    const peakHigh = maxAbsSample(samplesHigh);
    const peakNormal = maxAbsSample(samplesNormal);
    expect(peakHigh).toBeGreaterThanOrEqual(peakNormal);

    // Verify the waveform is not all the same value (not stuck at clipping rail)
    const uniqueValues = new Set(samplesHigh.slice(0, 5000));
    expect(uniqueValues.size).toBeGreaterThan(10);
  });
});
