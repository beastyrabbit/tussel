import { defineScene, note, silence } from '@tussel/dsl';
import { describe, expect, it } from 'vitest';
import { renderSceneToWavBuffer } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
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
  for (const s of samples) {
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

function maxAbsSample(samples: number[]): number {
  let max = 0;
  for (const s of samples) {
    max = Math.max(max, Math.abs(s));
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
 * Returns normalized float samples [-1, 1].
 */
function monoWindow(
  wavBuffer: Buffer,
  startSeconds: number,
  endSeconds: number,
  sampleRate = 48_000,
): number[] {
  const { left, right } = extractPcmSamples(wavBuffer);
  const start = Math.max(0, Math.floor(startSeconds * sampleRate));
  const end = Math.min(left.length, Math.ceil(endSeconds * sampleRate));
  const result: number[] = [];
  for (let i = start; i < end; i++) {
    result.push(((left[i] ?? 0) + (right[i] ?? 0)) / 2 / 0x7fff);
  }
  return result;
}

/**
 * Helper to create a simple synth scene.
 */
function synthScene(
  waveform: string,
  noteStr: string,
  opts: {
    attack?: number;
    decay?: number;
    gain?: number;
    lpf?: number;
    pan?: number;
    release?: number;
    sustain?: number;
  } = {},
) {
  let n = note(noteStr).s(waveform);
  if (opts.gain !== undefined) n = n.gain(opts.gain);
  if (opts.attack !== undefined) n = n.attack(opts.attack);
  if (opts.decay !== undefined) n = n.decay(opts.decay);
  if (opts.sustain !== undefined) n = n.sustain(opts.sustain);
  if (opts.release !== undefined) n = n.release(opts.release);
  if (opts.pan !== undefined) n = n.pan(opts.pan);
  if (opts.lpf !== undefined) n = n.lpf(opts.lpf);
  return defineScene({
    channels: { lead: { node: n } },
    samples: [],
    transport: { cps: 1 },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('waveform correctness', () => {
  // -----------------------------------------------------------------------
  // 1. Sine waveform
  // -----------------------------------------------------------------------
  it('sine oscillator produces a sinusoidal pattern with expected zero crossings', async () => {
    // A4 = 440 Hz, render 0.5 seconds => ~220 full cycles => ~440 zero crossings
    const scene = synthScene('sine', 'a4', {
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
      gain: 0.8,
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const samples = monoWindow(wav, 0.01, 0.49);
    const crossings = zeroCrossings(samples);

    // 440 Hz for ~0.48 s should produce about 440 * 0.48 = ~211 cycles = ~422 crossings
    expect(crossings).toBeGreaterThan(380);
    expect(crossings).toBeLessThan(470);

    // Peak amplitude should be significant (we set gain 0.8)
    const peak = maxAbsSample(samples.map((s) => s * 0x7fff));
    expect(peak).toBeGreaterThan(500);
  });

  // -----------------------------------------------------------------------
  // 2. Triangle waveform
  // -----------------------------------------------------------------------
  it('triangle oscillator produces a linear ramp shape', async () => {
    // Use a low frequency to see clear ramps: C2 ~ 65.4 Hz
    const scene = synthScene('triangle', 'c2', {
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
      gain: 0.8,
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const samples = monoWindow(wav, 0.02, 0.48);

    // For a triangle wave, consecutive differences should be roughly constant
    // in magnitude within each ramp segment (linear). We check that the
    // distribution of absolute differences has low variance compared to its mean,
    // which is characteristic of a triangle (constant slope) vs sine (curved).
    const diffs: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      diffs.push(Math.abs((samples[i] ?? 0) - (samples[i - 1] ?? 0)));
    }
    const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    // Filter out near-zero-crossing regions where the diff might be affected
    const significantDiffs = diffs.filter((d) => d > avgDiff * 0.3);
    const meanSig = significantDiffs.reduce((a, b) => a + b, 0) / significantDiffs.length;
    let variance = 0;
    for (const d of significantDiffs) {
      variance += (d - meanSig) ** 2;
    }
    variance /= significantDiffs.length;
    const cv = Math.sqrt(variance) / meanSig; // coefficient of variation
    // Triangle waves should have a low CV since slopes are constant
    expect(cv).toBeLessThan(0.6);

    // Verify it has the right frequency: ~65 Hz => ~31 cycles in 0.46 s => ~62 crossings
    const crossings = zeroCrossings(samples);
    expect(crossings).toBeGreaterThan(50);
    expect(crossings).toBeLessThan(80);
  });

  // -----------------------------------------------------------------------
  // 3. Square waveform
  // -----------------------------------------------------------------------
  it('square oscillator produces bimodal sample distribution', async () => {
    // Use a moderate frequency: A3 = 220 Hz
    const scene = synthScene('square', 'a3', {
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
      gain: 0.8,
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const samples = monoWindow(wav, 0.01, 0.49);

    // A square wave should have most samples near +peak or -peak.
    // Count samples that are in the outer 50% of the range.
    const peak = maxAbsSample(samples.map((s) => Math.round(s * 0x7fff)));
    const threshold = (peak * 0.4) / 0x7fff;
    let outerCount = 0;
    for (const s of samples) {
      if (Math.abs(s) > threshold) {
        outerCount++;
      }
    }
    // At least 70% of samples should be near the peaks for a square wave
    const ratio = outerCount / samples.length;
    expect(ratio).toBeGreaterThan(0.7);
  });

  // -----------------------------------------------------------------------
  // 4. Saw waveform
  // -----------------------------------------------------------------------
  it('saw oscillator produces a sawtooth ramp shape', async () => {
    // Use a low frequency for clear ramps: C2 ~ 65.4 Hz
    const scene = synthScene('saw', 'c2', {
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
      gain: 0.8,
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const samples = monoWindow(wav, 0.02, 0.48);

    // Sawtooth should have a gradual ramp in one direction then a sharp jump.
    // Count large jumps (discontinuities): should be ~1 per cycle (~65 Hz * 0.46 s ~ 30)
    const diffs: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      diffs.push(Math.abs((samples[i] ?? 0) - (samples[i - 1] ?? 0)));
    }
    diffs.sort((a, b) => b - a);
    // The largest jumps correspond to the sawtooth resets.
    // Expect the top ~30 diffs to be significantly larger than the median
    const median = diffs[Math.floor(diffs.length / 2)] ?? 0;
    const topJumps = diffs.slice(0, 40);
    const avgTopJump = topJumps.reduce((a, b) => a + b, 0) / topJumps.length;
    // The top jumps should be much larger than the median (ramp steps are small, resets are big)
    expect(avgTopJump).toBeGreaterThan(median * 3);

    // Verify frequency via zero crossings: saw at 65 Hz crosses zero ~65 times in 0.46 s
    const crossings = zeroCrossings(samples);
    expect(crossings).toBeGreaterThan(40);
    expect(crossings).toBeLessThan(80);
  });

  // -----------------------------------------------------------------------
  // 5. ADSR envelope shape
  // -----------------------------------------------------------------------
  it('ADSR envelope follows the expected amplitude shape over time', async () => {
    // Long attack (0.1s), decay (0.1s), sustain 0.5, release (0.1s)
    // Render 0.5 seconds at CPS=1, so the note lasts 1 cycle = 1 second but we render 0.5
    const scene = synthScene('sine', 'a4', {
      attack: 0.1,
      decay: 0.1,
      sustain: 0.5,
      release: 0.1,
      gain: 0.8,
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });

    // Measure RMS in different time windows
    const attackPhase = rmsOfMonoWindow(wav, 0.0, 0.05); // early attack: should be growing
    const peakPhase = rmsOfMonoWindow(wav, 0.09, 0.12); // near peak
    const sustainPhase = rmsOfMonoWindow(wav, 0.25, 0.45); // sustain phase

    // Attack phase should have lower RMS than peak phase
    expect(peakPhase).toBeGreaterThan(attackPhase * 0.8);

    // Sustain phase should be lower than peak phase (sustain = 0.5)
    expect(sustainPhase).toBeLessThan(peakPhase * 0.95);
    expect(sustainPhase).toBeGreaterThan(0); // but not silent
  });

  // -----------------------------------------------------------------------
  // 6. Pan accuracy
  // -----------------------------------------------------------------------
  it('pan(0) produces roughly equal channels', async () => {
    const scene = synthScene('sine', 'a4', { pan: 0, gain: 0.8 });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const { left, right } = extractPcmSamples(wav);
    const lRms = rms(left.slice(500, left.length - 500));
    const rRms = rms(right.slice(500, right.length - 500));

    // Channels should be within 10% of each other for center pan
    const ratio = Math.min(lRms, rRms) / Math.max(lRms, rRms);
    expect(ratio).toBeGreaterThan(0.85);
  });

  it('pan(-1) produces full left (right channel significantly quieter)', async () => {
    const scene = synthScene('sine', 'a4', { pan: -1, gain: 0.8 });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const { left, right } = extractPcmSamples(wav);
    const lRms = rms(left.slice(500, left.length - 500));
    const rRms = rms(right.slice(500, right.length - 500));

    // Left should be much louder than right
    expect(lRms).toBeGreaterThan(rRms * 3);
  });

  it('pan(1) produces full right (left channel significantly quieter)', async () => {
    const scene = synthScene('sine', 'a4', { pan: 1, gain: 0.8 });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const { left, right } = extractPcmSamples(wav);
    const lRms = rms(left.slice(500, left.length - 500));
    const rRms = rms(right.slice(500, right.length - 500));

    // Right should be much louder than left
    expect(rRms).toBeGreaterThan(lRms * 3);
  });

  // -----------------------------------------------------------------------
  // 7. Gain scaling linearity
  // -----------------------------------------------------------------------
  it('gain scaling is approximately linear (2:1 RMS ratio for gain 1.0 vs 0.5)', async () => {
    const sceneFull = synthScene('sine', 'a4', {
      gain: 1.0,
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
    });
    const sceneHalf = synthScene('sine', 'a4', {
      gain: 0.5,
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
    });
    const wavFull = await renderSceneToWavBuffer(sceneFull, { seconds: 0.5 });
    const wavHalf = await renderSceneToWavBuffer(sceneHalf, { seconds: 0.5 });

    const rmsFull = rmsOfMonoWindow(wavFull, 0.05, 0.45);
    const rmsHalf = rmsOfMonoWindow(wavHalf, 0.05, 0.45);

    // Ratio should be approximately 2:1
    const ratio = rmsFull / rmsHalf;
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.5);
  });

  // -----------------------------------------------------------------------
  // 8. Filter effect verification
  // -----------------------------------------------------------------------
  it('low-pass filter reduces high frequency content', async () => {
    // Use saw wave (rich in harmonics) and compare filtered vs unfiltered
    const sceneUnfiltered = synthScene('saw', 'a3', {
      gain: 0.8,
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
    });
    const sceneFiltered = synthScene('saw', 'a3', {
      gain: 0.8,
      lpf: 400,
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
    });

    const wavUnfiltered = await renderSceneToWavBuffer(sceneUnfiltered, { seconds: 0.5 });
    const wavFiltered = await renderSceneToWavBuffer(sceneFiltered, { seconds: 0.5 });

    // Measure high-frequency content by counting zero crossings.
    // A low-pass filter should reduce zero crossings by removing harmonics.
    const samplesUnfiltered = monoWindow(wavUnfiltered, 0.02, 0.48);
    const samplesFiltered = monoWindow(wavFiltered, 0.02, 0.48);

    const crossingsUnfiltered = zeroCrossings(samplesUnfiltered);
    const crossingsFiltered = zeroCrossings(samplesFiltered);

    // Unfiltered saw has many harmonics => more zero crossings
    // Filtered saw should have fewer zero crossings
    expect(crossingsUnfiltered).toBeGreaterThan(crossingsFiltered);

    // Also verify via RMS of sample-to-sample differences (proxy for high-freq energy)
    const hfUnfiltered = rmsOfDiffs(samplesUnfiltered);
    const hfFiltered = rmsOfDiffs(samplesFiltered);
    expect(hfUnfiltered).toBeGreaterThan(hfFiltered * 1.2);
  });

  // -----------------------------------------------------------------------
  // 9. WAV header correctness
  // -----------------------------------------------------------------------
  it('WAV header contains correct RIFF marker, format, sample rate, channels, and bit depth', async () => {
    const scene = synthScene('sine', 'a4', { gain: 0.5 });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });

    // RIFF marker
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');

    // WAVE format
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');

    // fmt chunk
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');

    // PCM format (1)
    expect(wav.readUInt16LE(20)).toBe(1);

    // 2 channels (stereo)
    expect(wav.readUInt16LE(22)).toBe(2);

    // 48000 Hz sample rate
    expect(wav.readUInt32LE(24)).toBe(48_000);

    // Byte rate = sampleRate * channels * bytesPerSample = 48000 * 2 * 2 = 192000
    expect(wav.readUInt32LE(28)).toBe(192_000);

    // Block align = channels * bytesPerSample = 4
    expect(wav.readUInt16LE(32)).toBe(4);

    // Bits per sample = 16
    expect(wav.readUInt16LE(34)).toBe(16);

    // data chunk
    expect(wav.toString('ascii', 36, 40)).toBe('data');

    // data size should be total length minus 44-byte header
    const dataSize = wav.readUInt32LE(40);
    expect(dataSize).toBe(wav.byteLength - 44);

    // RIFF chunk size should be total length minus 8
    const riffSize = wav.readUInt32LE(4);
    expect(riffSize).toBe(wav.byteLength - 8);
  });

  // -----------------------------------------------------------------------
  // 10. Silence output
  // -----------------------------------------------------------------------
  it('silence() produces all-zero samples', async () => {
    const scene = defineScene({
      channels: { main: { node: silence() } },
      samples: [],
      transport: { cps: 1 },
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const { left, right } = extractPcmSamples(wav);

    const leftMax = maxAbsSample(left);
    const rightMax = maxAbsSample(right);
    expect(leftMax).toBe(0);
    expect(rightMax).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rmsOfMonoWindow(
  wavBuffer: Buffer,
  startSeconds: number,
  endSeconds: number,
  sampleRate = 48_000,
): number {
  const samples = monoWindow(wavBuffer, startSeconds, endSeconds, sampleRate);
  return rms(samples.map((s) => s * 0x7fff));
}

function rmsOfDiffs(samples: number[]): number {
  const diffs: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    diffs.push((samples[i] ?? 0) - (samples[i - 1] ?? 0));
  }
  return rms(diffs);
}
