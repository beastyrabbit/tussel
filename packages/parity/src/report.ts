import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveTusselCacheDir, stableJson } from '@tussel/ir';
import type { FixtureRunResult, ParityRunSummary } from './schema.js';

const PARITY_CACHE = resolveTusselCacheDir('parity');

export async function writeSummary(results: FixtureRunResult[]): Promise<ParityRunSummary> {
  await mkdir(PARITY_CACHE, { recursive: true });
  const summary: ParityRunSummary = {
    fixtureCount: results.length,
    levelCounts: {},
    ok: results.every((result) => result.ok),
    results: results.map((result) => ({
      audio: result.comparison.audio,
      events: result.comparison.events,
      fixtureId: result.fixture.id,
      level: result.fixture.level,
      ok: result.ok,
    })),
  };

  for (const result of results) {
    const key = `${result.fixture.level}`;
    summary.levelCounts[key] ??= { failed: 0, passed: 0 };
    if (result.ok) {
      summary.levelCounts[key].passed += 1;
    } else {
      summary.levelCounts[key].failed += 1;
    }
  }

  await writeFile(path.join(PARITY_CACHE, 'latest.json'), stableJson(summary));
  return summary;
}

export async function writeFailureArtifacts(result: FixtureRunResult): Promise<void> {
  if (result.ok) {
    return;
  }

  const targetDir = path.join(PARITY_CACHE, 'failures', sanitizeFixtureId(result.fixture.id));
  await mkdir(targetDir, { recursive: true });

  if (result.expectedEvents) {
    await writeFile(path.join(targetDir, 'oracle.events.json'), stableJson(result.expectedEvents));
  }
  if (result.actualEvents) {
    await writeFile(path.join(targetDir, 'tussel.events.json'), stableJson(result.actualEvents));
  }
  if (result.expectedAudio) {
    await writeFile(path.join(targetDir, 'oracle.wav'), result.expectedAudio);
  }
  if (result.actualAudio) {
    await writeFile(path.join(targetDir, 'tussel.wav'), result.actualAudio);
  }
  await writeFile(path.join(targetDir, 'diff.json'), stableJson(result.comparison));

  if (result.canonicalFromTidal) {
    const contents = await readFile(result.canonicalFromTidal, 'utf8');
    await writeFile(path.join(targetDir, 'canonical.from-tidal.scene.ts'), contents);
  }
  if (result.canonicalFromStrudel) {
    const contents = await readFile(result.canonicalFromStrudel, 'utf8');
    await writeFile(path.join(targetDir, 'canonical.from-strudel.scene.ts'), contents);
  }
}

function sanitizeFixtureId(value: string): string {
  return value.replace(/[^\w.-]+/g, '_');
}
