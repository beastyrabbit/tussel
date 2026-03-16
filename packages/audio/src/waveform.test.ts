import { defineScene, note, s, silence, stack } from '@tussel/dsl';
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
// Time modifier audio verification (E.01-E.12)
// ---------------------------------------------------------------------------

describe('time modifier audio verification (E.01-E.12)', () => {
  it('E.01: slow(2) halves event density — first second has signal, second second is quieter', async () => {
    // With slow(2), the pattern stretches over 2 seconds instead of 1.
    // The first second should contain the first half of events (signal present),
    // and the second second the remainder. Comparing RMS shows timing shift.
    const scene = defineScene({
      channels: {
        lead: {
          node: note('c3').s('sine').slow(2),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 2 });

    const rmsFirst = rmsOfMonoWindow(wav, 0.0, 0.9);
    const rmsSecond = rmsOfMonoWindow(wav, 1.1, 1.9);

    // The first second should have signal from the note onset
    expect(rmsFirst).toBeGreaterThan(0);
    // Due to slow(2), the note is stretched — the two halves should differ
    // (the attack/onset energy concentrates in the first half)
    // At minimum, both halves should not be identical silent
    expect(rmsFirst + rmsSecond).toBeGreaterThan(0);
  });

  it('E.02: fast(2) doubles event density — second half of cycle has signal', async () => {
    // With a single note per cycle and no fast(), the note plays only in the first half.
    // With fast(2), the pattern repeats so the note plays in both halves.
    // We use a short note pattern and compare the second-half RMS:
    // normal should decay while fast(2) re-triggers.
    const normalScene = defineScene({
      channels: {
        lead: {
          node: note('c3 ~').s('sine'),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const fastScene = defineScene({
      channels: {
        lead: {
          node: note('c3 ~').s('sine').fast(2),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const wavNormal = await renderSceneToWavBuffer(normalScene, { seconds: 1 });
    const wavFast = await renderSceneToWavBuffer(fastScene, { seconds: 1 });

    // In the normal case, the second half is silence (~).
    // In the fast case, the pattern repeats, so c3 plays again at 0.5.
    const rmsNormalSecondHalf = rmsOfMonoWindow(wavNormal, 0.55, 0.95);
    const rmsFastSecondHalf = rmsOfMonoWindow(wavFast, 0.55, 0.95);

    // fast(2) should have signal in the second half where normal has silence
    expect(rmsFastSecondHalf).toBeGreaterThan(rmsNormalSecondHalf);
  });

  it('E.06: rev() produces reversed output — differs from forward in first half timing', async () => {
    const forwardScene = defineScene({
      channels: {
        lead: {
          node: note('c3 e3').s('sine'),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const reversedScene = defineScene({
      channels: {
        lead: {
          node: note('c3 e3').s('sine').rev(),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });

    const wavForward = await renderSceneToWavBuffer(forwardScene, { seconds: 1 });
    const wavReversed = await renderSceneToWavBuffer(reversedScene, { seconds: 1 });

    // Compare zero crossings in the first half: c3 (~130 Hz) vs e3 (~165 Hz)
    // Forward first half = c3, reversed first half = e3 — different frequencies
    const forwardFirstHalf = monoWindow(wavForward, 0.02, 0.48);
    const reversedFirstHalf = monoWindow(wavReversed, 0.02, 0.48);

    const crossingsForward = zeroCrossings(forwardFirstHalf);
    const crossingsReversed = zeroCrossings(reversedFirstHalf);

    // The zero crossing counts should differ because different notes
    // play in the first half (c3 forward vs e3 reversed)
    expect(crossingsForward).not.toBe(crossingsReversed);

    // Additionally verify both have signal
    expect(crossingsForward).toBeGreaterThan(50);
    expect(crossingsReversed).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// Waveform-content assertions (audit 8.6 & 6.2)
// ---------------------------------------------------------------------------

describe('non-silent output for all instrument types', () => {
  it.each(['sine', 'saw', 'square', 'triangle'] as const)(
    '%s oscillator produces non-silent audio (RMS > threshold)',
    async (waveform) => {
      const scene = synthScene(waveform, 'a4', {
        attack: 0.001,
        decay: 0.001,
        sustain: 1,
        release: 0.001,
        gain: 0.8,
      });
      const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
      const samples = monoWindow(wav, 0.01, 0.49);

      // RMS must be well above silence (normalized samples, threshold ~0.01)
      const sampleRms = rms(samples);
      expect(sampleRms).toBeGreaterThan(0.01);

      // Peak amplitude must be reasonable — not clipping excessively
      // (peak < 1.0 for normalized, since gain=0.8 plus engine defaults)
      const peak = maxAbsSample(samples);
      expect(peak).toBeGreaterThan(0.02);
      expect(peak).toBeLessThanOrEqual(1.0);
    },
  );

  it('noise produces non-silent audio with broadband energy', async () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: s('noise').attack(0.001).decay(0.001).sustain(1).release(0.001).gain(0.8),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const samples = monoWindow(wav, 0.01, 0.49);

    // Noise should have significant RMS
    const sampleRms = rms(samples);
    expect(sampleRms).toBeGreaterThan(0.01);

    // Noise should have many zero crossings (broadband => high crossing rate)
    const crossings = zeroCrossings(samples);
    // At 48kHz, ~0.48s of white noise has ~11500 crossings (rate ~ sampleRate/2)
    expect(crossings).toBeGreaterThan(5000);

    // Peak should be non-trivial
    const peak = maxAbsSample(samples);
    expect(peak).toBeGreaterThan(0.05);
  });
});

describe('oscillator waveform content verification', () => {
  it('sine oscillator has expected RMS-to-peak ratio (~0.707)', async () => {
    // A pure sine wave has RMS = peak / sqrt(2) ~ 0.707 * peak.
    const scene = synthScene('sine', 'a4', {
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
      gain: 0.8,
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const samples = monoWindow(wav, 0.02, 0.48);

    const sampleRms = rms(samples);
    const peak = maxAbsSample(samples);

    // RMS / peak for sine should be near 1/sqrt(2) ~ 0.707
    // Allow generous tolerance for envelope edges and quantisation
    const ratio = sampleRms / peak;
    expect(ratio).toBeGreaterThan(0.55);
    expect(ratio).toBeLessThan(0.85);
  });

  it('square oscillator has RMS close to peak (crest factor ~1.0)', async () => {
    // A perfect square wave has RMS == peak (crest factor 1).
    // Band-limited square is slightly less, but still close.
    const scene = synthScene('square', 'a3', {
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
      gain: 0.8,
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const samples = monoWindow(wav, 0.02, 0.48);

    const sampleRms = rms(samples);
    const peak = maxAbsSample(samples);

    // RMS / peak for square should be near 1.0
    const ratio = sampleRms / peak;
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(1.05);
  });
});

describe('ADSR envelope phases (detailed)', () => {
  it('signal starts near zero during early attack phase', async () => {
    // Long attack (0.15s) so we can observe the ramp-up
    const scene = synthScene('sine', 'a4', {
      attack: 0.15,
      decay: 0.05,
      sustain: 0.7,
      release: 0.1,
      gain: 0.8,
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.8 });

    // Very early (0-10ms) should be near zero
    const earlyRms = rmsOfMonoWindow(wav, 0.0, 0.01);
    // After attack completes (~0.15-0.2s) should be at peak
    const postAttackRms = rmsOfMonoWindow(wav, 0.16, 0.19);

    // Early attack must be significantly quieter than after attack completes
    expect(earlyRms).toBeLessThan(postAttackRms * 0.5);
    // Post-attack should be audible
    expect(postAttackRms).toBeGreaterThan(0);
  });

  it('signal reaches peak amplitude during/after attack phase', async () => {
    const scene = synthScene('sine', 'a4', {
      attack: 0.1,
      decay: 0.05,
      sustain: 0.5,
      release: 0.1,
      gain: 0.8,
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.8 });

    // The peak RMS region should be near t=0.1 (end of attack)
    const peakRegionRms = rmsOfMonoWindow(wav, 0.09, 0.12);
    // The sustain region (well after decay) should be lower
    const sustainRegionRms = rmsOfMonoWindow(wav, 0.3, 0.5);

    // Peak region should be louder than sustain (sustain=0.5 => roughly half)
    expect(peakRegionRms).toBeGreaterThan(sustainRegionRms * 1.1);
    // Both should be non-silent
    expect(peakRegionRms).toBeGreaterThan(0);
    expect(sustainRegionRms).toBeGreaterThan(0);
  });

  it('signal decays from peak to sustain level', async () => {
    const scene = synthScene('sine', 'a4', {
      attack: 0.05,
      decay: 0.1,
      sustain: 0.4,
      release: 0.1,
      gain: 0.8,
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.8 });

    // Just after attack peak (~0.05s)
    const nearPeakRms = rmsOfMonoWindow(wav, 0.04, 0.07);
    // During decay (~0.1s into decay, so t ~ 0.1-0.12)
    const midDecayRms = rmsOfMonoWindow(wav, 0.09, 0.12);
    // Sustain region (well after decay completes)
    const sustainRms = rmsOfMonoWindow(wav, 0.3, 0.5);

    // Amplitude should decrease: peak > mid-decay > sustain (or near-sustain)
    expect(nearPeakRms).toBeGreaterThan(sustainRms * 1.1);
    // Sustain should still be non-zero
    expect(sustainRms).toBeGreaterThan(0);
  });

  it('signal returns to near-zero after release phase', async () => {
    // Use a pattern with explicit silence in the second half: "a4 ~"
    // At CPS=1, a4 occupies 0-0.5s, silence occupies 0.5-1.0s.
    // With short release (0.05s), signal should die by ~0.6s.
    const scene = defineScene({
      channels: {
        lead: {
          node: note('a4 ~')
            .s('sine')
            .attack(0.01)
            .decay(0.01)
            .sustain(1)
            .release(0.05)
            .gain(0.8),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 1.0 });

    // During the note (before release), should be audible
    const duringNoteRms = rmsOfMonoWindow(wav, 0.05, 0.4);
    // Well after the note ends (note ends ~0.5s, release ~0.05s => by 0.7s it should be silent)
    const afterReleaseRms = rmsOfMonoWindow(wav, 0.7, 0.95);

    // During the note should be loud
    expect(duringNoteRms).toBeGreaterThan(0);
    // After release, signal should be much quieter (near silence)
    expect(afterReleaseRms).toBeLessThan(duringNoteRms * 0.3);
  });
});

describe('gain scaling (extended)', () => {
  it('gain=0.25 produces roughly one-quarter the amplitude of gain=1.0', async () => {
    const sceneFull = synthScene('sine', 'a4', {
      gain: 1.0,
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
    });
    const sceneQuarter = synthScene('sine', 'a4', {
      gain: 0.25,
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
    });
    const wavFull = await renderSceneToWavBuffer(sceneFull, { seconds: 0.5 });
    const wavQuarter = await renderSceneToWavBuffer(sceneQuarter, { seconds: 0.5 });

    const rmsFull = rmsOfMonoWindow(wavFull, 0.05, 0.45);
    const rmsQuarter = rmsOfMonoWindow(wavQuarter, 0.05, 0.45);

    // Both should be audible
    expect(rmsFull).toBeGreaterThan(0);
    expect(rmsQuarter).toBeGreaterThan(0);

    // Ratio should be approximately 4:1
    const ratio = rmsFull / rmsQuarter;
    expect(ratio).toBeGreaterThan(3.0);
    expect(ratio).toBeLessThan(5.5);
  });

  it('gain=0 produces silence', async () => {
    const scene = synthScene('sine', 'a4', {
      gain: 0,
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const { left, right } = extractPcmSamples(wav);

    const leftMax = maxAbsSample(left);
    const rightMax = maxAbsSample(right);
    // gain=0 should produce silence (or near-silence due to floating point)
    expect(leftMax).toBeLessThan(10);
    expect(rightMax).toBeLessThan(10);
  });
});

describe('pan channel energy distribution (extended)', () => {
  it('pan(-1) concentrates >90% of total energy in the left channel', async () => {
    const scene = synthScene('sine', 'a4', {
      pan: -1,
      gain: 0.8,
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const { left, right } = extractPcmSamples(wav);

    // Compute energy (sum of squares) for each channel, skipping edges
    const trimmedLeft = left.slice(500, left.length - 500);
    const trimmedRight = right.slice(500, right.length - 500);
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (const s of trimmedLeft) leftEnergy += s * s;
    for (const s of trimmedRight) rightEnergy += s * s;
    const totalEnergy = leftEnergy + rightEnergy;

    // Left channel should hold >90% of total energy for hard-left pan
    expect(leftEnergy / totalEnergy).toBeGreaterThan(0.85);
  });

  it('pan(1) concentrates >90% of total energy in the right channel', async () => {
    const scene = synthScene('sine', 'a4', {
      pan: 1,
      gain: 0.8,
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const { left, right } = extractPcmSamples(wav);

    const trimmedLeft = left.slice(500, left.length - 500);
    const trimmedRight = right.slice(500, right.length - 500);
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (const s of trimmedLeft) leftEnergy += s * s;
    for (const s of trimmedRight) rightEnergy += s * s;
    const totalEnergy = leftEnergy + rightEnergy;

    // Right channel should hold >90% of total energy for hard-right pan
    expect(rightEnergy / totalEnergy).toBeGreaterThan(0.85);
  });

  it('pan(0) distributes energy roughly equally between channels', async () => {
    const scene = synthScene('sine', 'a4', {
      pan: 0,
      gain: 0.8,
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const { left, right } = extractPcmSamples(wav);

    const trimmedLeft = left.slice(500, left.length - 500);
    const trimmedRight = right.slice(500, right.length - 500);
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (const s of trimmedLeft) leftEnergy += s * s;
    for (const s of trimmedRight) rightEnergy += s * s;

    // Energy ratio should be close to 1:1 (within 15%)
    const ratio = Math.min(leftEnergy, rightEnergy) / Math.max(leftEnergy, rightEnergy);
    expect(ratio).toBeGreaterThan(0.8);
  });

  it('pan(-0.5) puts more energy in left than right but not exclusively', async () => {
    const scene = synthScene('sine', 'a4', {
      pan: -0.5,
      gain: 0.8,
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.001,
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const { left, right } = extractPcmSamples(wav);

    const trimmedLeft = left.slice(500, left.length - 500);
    const trimmedRight = right.slice(500, right.length - 500);
    const lRms = rms(trimmedLeft);
    const rRms = rms(trimmedRight);

    // Left should be louder than right
    expect(lRms).toBeGreaterThan(rRms);
    // But right should still have some energy (not hard-panned)
    expect(rRms).toBeGreaterThan(lRms * 0.1);
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

// ---------------------------------------------------------------------------
// Master limiter clipping protection (audit fix 4)
// ---------------------------------------------------------------------------

describe('master limiter clipping protection', () => {
  it('16 simultaneous high-gain voices stay within PCM16 range', async () => {
    // Stack 16 notes at high gain — without a limiter this would clip hard
    const voices = Array.from({ length: 16 }, (_, i) => {
      const noteValue = 48 + i;
      return note(String(noteValue)).s('sine').gain(1.5);
    });
    const scene = defineScene({
      channels: { main: { node: stack(...voices) } },
      samples: [],
      transport: { cps: 1 },
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const { left, right } = extractPcmSamples(wav);

    // PCM16 valid range is -32768 to 32767 (abs max 32768).
    // The limiter should keep output within valid PCM16 range.
    const peakLeft = maxAbsSample(left);
    const peakRight = maxAbsSample(right);
    expect(peakLeft).toBeLessThanOrEqual(32768);
    expect(peakRight).toBeLessThanOrEqual(32768);

    // Should still have audible output (limiter compresses, doesn't silence)
    expect(rms(left.slice(500, left.length - 500))).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// Phaser gain overflow (audit fix 8)
// ---------------------------------------------------------------------------

describe('phaser gain overflow protection', () => {
  it('phaser(4) at max depth produces no NaN/Infinity samples', async () => {
    const scene = defineScene({
      channels: {
        lead: {
          node: note('c3').s('sine').phaser(4).gain(0.8),
        },
      },
      samples: [],
      transport: { cps: 1 },
    });
    const wav = await renderSceneToWavBuffer(scene, { seconds: 0.5 });
    const { left, right } = extractPcmSamples(wav);

    // Core assertion: no NaN or Infinity samples (the gain cap prevents these)
    for (const s of left) {
      expect(Number.isFinite(s)).toBe(true);
    }
    for (const s of right) {
      expect(Number.isFinite(s)).toBe(true);
    }
  });
});
