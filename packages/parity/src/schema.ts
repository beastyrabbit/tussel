export interface ExternalFixtureSource {
  code?: string;
  entry?: string;
  path?: string;
  shape: 'pattern' | 'script';
}

export interface AudioToleranceThresholds {
  maxAbsoluteDelta?: number;
  rmsDelta?: number;
}

/**
 * Selects which comparison strategy to use for audio parity checks.
 *
 * - `'exact'`      — byte-identical PCM data (strictest, no tolerance).
 * - `'rms'`        — pass when the RMS of the difference signal is within threshold.
 * - `'max-delta'`  — pass when no individual sample exceeds the threshold.
 * - `'tolerance'`  — pass when *both* RMS and max-delta are within thresholds (default tolerant mode).
 */
export type AudioCompareMode = 'exact' | 'max-delta' | 'rms' | 'tolerance';

export interface ParityFixture {
  compare: {
    audio?: 'exact-pcm16' | 'tolerance';
    audioTolerance?: AudioToleranceThresholds;
    events?: 'exact';
  };
  cps: number;
  durationCycles: number;
  id: string;
  importTargets: Array<'strudel' | 'tidal'>;
  level: 1 | 2 | 3 | 4 | 5;
  samplePack?: string;
  seed?: number;
  sources: {
    strudel?: ExternalFixtureSource;
    tidal?: ExternalFixtureSource;
  };
  title: string;
}

export interface LoadedParityFixture extends ParityFixture {
  fixturePath: string;
}

export interface NormalizedEvent {
  begin: number;
  channel: string;
  duration: number;
  end: number;
  payload: Record<string, boolean | null | number | string>;
}

export interface EventComparisonResult {
  firstMismatch?: {
    actual?: NormalizedEvent;
    expected?: NormalizedEvent;
    index: number;
  };
  ok: boolean;
}

export interface AudioComparisonResult {
  actualBytes: number;
  actualSilent?: boolean;
  expectedBytes: number;
  expectedSilent?: boolean;
  firstMismatchSample?: number;
  maxAbsoluteDelta?: number;
  ok: boolean;
  rmsDelta?: number;
}

export interface FixtureRunResult {
  actualAudio?: Buffer;
  actualEvents?: NormalizedEvent[];
  canonicalFromStrudel?: string;
  canonicalFromTidal?: string;
  comparison: {
    audio?: AudioComparisonResult;
    events?: EventComparisonResult;
  };
  expectedAudio?: Buffer;
  expectedEvents?: NormalizedEvent[];
  fixture: LoadedParityFixture;
  ok: boolean;
}

export interface ParityRunSummary {
  fixtureCount: number;
  levelCounts: Record<string, { failed: number; passed: number }>;
  ok: boolean;
  results: Array<{
    audio?: AudioComparisonResult;
    events?: EventComparisonResult;
    fixtureId: string;
    level: number;
    ok: boolean;
  }>;
}
