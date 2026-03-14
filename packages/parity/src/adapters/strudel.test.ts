import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { queryStrudelEvents, renderStrudelAudio, resolveStrudelSourceCode } from './strudel.js';

const strudelAvailable = existsSync(path.resolve('.ref/strudel/packages/core/index.mjs'));

if (!strudelAvailable) {
  throw new Error(
    'Strudel adapter tests require .ref/strudel checkout. ' +
      'Run `git submodule update --init` or see docs/parity-suite.md.',
  );
}

// ---------------------------------------------------------------------------
// Tests that require the .ref/strudel checkout
// ---------------------------------------------------------------------------
describe('Strudel reference audio adapter', () => {
  it('keeps note-only patterns audible through Strudel defaults', async () => {
    const wav = await renderStrudelAudio(`note("a3 c#4 e4 a4")`, {
      cps: 1,
      durationCycles: 4,
    });

    expect(maxSampleMagnitude(wav)).toBeGreaterThan(0);
  });

  it('produces a valid WAV header', async () => {
    const wav = await renderStrudelAudio(`note("c4")`, {
      cps: 1,
      durationCycles: 1,
    });

    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM format
    expect(wav.readUInt16LE(22)).toBe(2); // stereo
    expect(wav.readUInt32LE(24)).toBe(48_000); // sample rate
    expect(wav.readUInt16LE(34)).toBe(16); // 16-bit
  });

  it('renders appropriate sample count for the requested duration', async () => {
    const cps = 1;
    const durationCycles = 2;
    const wav = await renderStrudelAudio(`note("c4 e4")`, {
      cps,
      durationCycles,
    });

    const seconds = durationCycles / cps;
    const sampleRate = 48_000;
    const expectedFrames = Math.ceil(seconds * sampleRate);
    const channels = 2;
    const bytesPerSample = 2;
    const expectedDataBytes = expectedFrames * channels * bytesPerSample;

    // Data chunk size is at byte offset 40 in a canonical WAV header
    const dataSize = wav.readUInt32LE(40);
    expect(dataSize).toBe(expectedDataBytes);
    expect(wav.byteLength).toBe(44 + expectedDataBytes);
  });

  it('scales sample count with cps', async () => {
    const durationCycles = 4;
    const cps = 2;
    const wav = await renderStrudelAudio(`note("c4")`, {
      cps,
      durationCycles,
    });

    const seconds = durationCycles / cps; // 2 seconds
    const expectedFrames = Math.ceil(seconds * 48_000);
    const expectedDataBytes = expectedFrames * 2 * 2;
    expect(wav.readUInt32LE(40)).toBe(expectedDataBytes);
  });
});

// ---------------------------------------------------------------------------
// Strudel event queries (require .ref/strudel)
// ---------------------------------------------------------------------------
describe('Strudel event queries', () => {
  it('returns expected event count for a simple sound pattern', async () => {
    const events = await queryStrudelEvents(`sound("bd cp hh")`, {
      cps: 1,
      durationCycles: 1,
    });

    expect(events).toHaveLength(3);
  });

  it('returns events with correct timing for a two-element pattern', async () => {
    const events = await queryStrudelEvents(`sound("bd cp")`, {
      cps: 1,
      durationCycles: 1,
    });

    expect(events).toHaveLength(2);
    // First event starts at 0, second at 0.5
    expect(events[0]!.begin).toBeCloseTo(0, 6);
    expect(events[0]!.end).toBeCloseTo(0.5, 6);
    expect(events[1]!.begin).toBeCloseTo(0.5, 6);
    expect(events[1]!.end).toBeCloseTo(1, 6);
  });

  it('multiplies events across multiple cycles', async () => {
    const events = await queryStrudelEvents(`sound("bd")`, {
      cps: 1,
      durationCycles: 4,
    });

    expect(events).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(events[i]!.begin).toBeCloseTo(i, 6);
      expect(events[i]!.end).toBeCloseTo(i + 1, 6);
    }
  });

  it('populates sound name in the event payload', async () => {
    const events = await queryStrudelEvents(`sound("bd cp")`, {
      cps: 1,
      durationCycles: 1,
    });

    expect(events[0]!.payload.s).toBe('bd');
    expect(events[1]!.payload.s).toBe('cp');
  });

  it('populates correct note pitch values in the event payload', async () => {
    const events = await queryStrudelEvents(`note("c4 e4 g4")`, {
      cps: 1,
      durationCycles: 1,
    });

    expect(events).toHaveLength(3);
    // Strudel note values are MIDI-based; c4 = 60, e4 = 64, g4 = 67
    expect(events[0]!.payload.note).toBe(60);
    expect(events[1]!.payload.note).toBe(64);
    expect(events[2]!.payload.note).toBe(67);
  });

  it('returns events sorted by begin time', async () => {
    const events = await queryStrudelEvents(`sound("bd cp hh oh")`, {
      cps: 1,
      durationCycles: 2,
    });

    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.begin).toBeGreaterThanOrEqual(events[i - 1]!.begin);
    }
  });

  it('respects channel override', async () => {
    const events = await queryStrudelEvents(`sound("bd")`, {
      channel: 'drums',
      cps: 1,
      durationCycles: 1,
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.channel).toBe('drums');
  });

  it('handles sub-patterns with brackets', async () => {
    // "bd [cp hh]" means bd takes first half, cp and hh split second half
    const events = await queryStrudelEvents(`sound("bd [cp hh]")`, {
      cps: 1,
      durationCycles: 1,
    });

    expect(events).toHaveLength(3);
    expect(events[0]!.payload.s).toBe('bd');
    expect(events[0]!.begin).toBeCloseTo(0, 6);
    expect(events[0]!.end).toBeCloseTo(0.5, 6);
  });

  it('handles the rest (~) operator', async () => {
    const events = await queryStrudelEvents(`sound("bd ~ cp ~")`, {
      cps: 1,
      durationCycles: 1,
    });

    expect(events).toHaveLength(2);
    expect(events[0]!.payload.s).toBe('bd');
    expect(events[1]!.payload.s).toBe('cp');
  });
});

// ---------------------------------------------------------------------------
// resolveStrudelSourceCode (pure logic, no .ref/strudel needed)
// ---------------------------------------------------------------------------
describe('resolveStrudelSourceCode', () => {
  it('returns inline code when code is provided', async () => {
    const code = 'sound("bd cp")';
    const result = await resolveStrudelSourceCode({
      code,
      shape: 'pattern',
    });

    expect(result).toBe(code);
  });

  it('throws when source has neither code nor path', async () => {
    await expect(
      resolveStrudelSourceCode({ shape: 'pattern' }),
    ).rejects.toThrow('requires either code or path');
  });

  it('reads from a file path when code is not provided', async () => {
    // Use a known file in the repo as the path target
    const testPath = path.resolve(
      '/mnt/storage/workspace/projects/tussel/packages/parity/package.json',
    );
    const result = await resolveStrudelSourceCode({
      path: testPath,
      shape: 'pattern',
    });

    expect(result).toContain('"@tussel/parity"');
  });

  it('returns code unchanged without trimming or transformation', async () => {
    const code = '  note("c4 e4")  \n';
    const result = await resolveStrudelSourceCode({
      code,
      shape: 'pattern',
    });

    expect(result).toBe(code);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function maxSampleMagnitude(wav: Buffer): number {
  let max = 0;
  for (let offset = 44; offset + 1 < wav.byteLength; offset += 2) {
    max = Math.max(max, Math.abs(wav.readInt16LE(offset)));
  }
  return max;
}
