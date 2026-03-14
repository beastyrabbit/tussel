import { execFile } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { renderStrudelAudio, resolveStrudelSourceCode } from './adapters/strudel.js';
import { queryTidalEvents } from './adapters/tidal-ffi.js';
import {
  prepareTusselScene,
  queryTusselEvents,
  renderStableScene,
  renderTusselAudio,
} from './adapters/tussel.js';
import { compareAudio, compareAudioWithTolerance } from './compare-audio.js';
import { compareEvents } from './compare-events.js';
import { loadFixtures } from './load-fixtures.js';
import { writeFailureArtifacts, writeSummary } from './report.js';
import type { FixtureRunResult, LoadedParityFixture } from './schema.js';

export async function runParity(
  options: { fixtureId?: string; level?: number; saveArtifacts?: boolean } = {},
): Promise<FixtureRunResult[]> {
  const fixtures = await loadFixtures({ fixtureId: options.fixtureId, level: options.level });
  const results: FixtureRunResult[] = [];

  for (const fixture of fixtures) {
    const result = await runFixture(fixture);
    results.push(result);
    if (!result.ok && options.saveArtifacts) {
      await writeFailureArtifacts(result);
    }
  }

  await writeSummary(results);
  return results;
}

export async function runFixture(fixture: LoadedParityFixture): Promise<FixtureRunResult> {
  const imported = new Map<'strudel' | 'tidal', Awaited<ReturnType<typeof prepareTusselScene>>>();
  for (const target of fixture.importTargets) {
    const source = fixture.sources[target];
    if (!source) {
      throw new Error(`Fixture ${fixture.id} is missing ${target} source.`);
    }
    imported.set(target, await prepareTusselScene(sourceKindForTarget(target, source.path), source));
  }

  const importedTidal = imported.get('tidal');
  const importedStrudel = imported.get('strudel');

  if (
    importedTidal &&
    importedStrudel &&
    renderStableScene(importedTidal) !== renderStableScene(importedStrudel)
  ) {
    return {
      canonicalFromStrudel: importedStrudel.canonicalSceneTsPath,
      canonicalFromTidal: importedTidal.canonicalSceneTsPath,
      comparison: {},
      fixture,
      ok: false,
    };
  }

  const prepared = imported.get('strudel') ?? imported.get('tidal');
  if (!prepared) {
    throw new Error(`Fixture ${fixture.id} did not produce an imported Tussel scene.`);
  }

  const result: FixtureRunResult = {
    canonicalFromStrudel: importedStrudel?.canonicalSceneTsPath,
    canonicalFromTidal: importedTidal?.canonicalSceneTsPath,
    comparison: {},
    fixture,
    ok: true,
  };
  const hasAudioComparison = fixture.compare.audio === 'exact-pcm16' || fixture.compare.audio === 'tolerance';
  const durationCycles = hasAudioComparison
    ? minimumAudioDurationCycles(fixture.cps, fixture.durationCycles)
    : fixture.durationCycles;

  if (fixture.compare.events === 'exact') {
    if (!fixture.sources.tidal) {
      throw new Error(`Fixture ${fixture.id} is missing Tidal source for event parity.`);
    }
    result.expectedEvents = await queryTidalEvents(fixture.sources.tidal, {
      cps: fixture.cps,
      durationCycles,
    });
    result.actualEvents = await queryTusselEvents(prepared, {
      cps: fixture.cps,
      durationCycles,
    });
    result.comparison.events = compareEvents(result.expectedEvents, result.actualEvents);
    result.ok &&= result.comparison.events.ok;
  }

  if (hasAudioComparison) {
    if (!fixture.sources.strudel) {
      throw new Error(`Fixture ${fixture.id} is missing Strudel source for audio parity.`);
    }
    result.expectedAudio = await renderStrudelAudio(resolveStrudelSourceCode(fixture.sources.strudel), {
      cps: fixture.cps,
      durationCycles,
      samplePack: fixture.samplePack,
    });
    result.actualAudio = await renderTusselAudio(prepared, {
      cps: fixture.cps,
      durationCycles,
      samplePack: fixture.samplePack,
    });
    result.comparison.audio =
      fixture.compare.audio === 'tolerance'
        ? compareAudioWithTolerance(result.expectedAudio, result.actualAudio, fixture.compare.audioTolerance)
        : compareAudio(result.expectedAudio, result.actualAudio);
    result.ok &&= result.comparison.audio.ok;
  }

  return result;
}

function minimumAudioDurationCycles(cps: number, durationCycles: number): number {
  return Math.max(durationCycles, Math.ceil(cps * 10));
}

export async function doctorParity(): Promise<void> {
  const requiredPaths = [
    '.ref/strudel/package.json',
    '.ref/strudel/packages/transpiler/index.mjs',
    '.ref/strudel/packages/supradough/dough.mjs',
    '.ref/tidal',
    '.ref/strudel/node_modules',
  ];
  for (const requiredPath of requiredPaths) {
    try {
      await stat(path.resolve(requiredPath));
    } catch {
      throw new Error(`Missing parity prerequisite: ${requiredPath}`);
    }
  }

  await verifyPinnedCommits();
}

const execFileAsync = promisify(execFile);

async function verifyPinnedCommits(): Promise<void> {
  const pinnedPath = path.resolve('.ref', 'PINNED_COMMITS');
  let pinnedContent: string;
  try {
    pinnedContent = await readFile(pinnedPath, 'utf-8');
  } catch {
    return;
  }

  const pinned = new Map<string, string>();
  for (const line of pinnedContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const [name, commit] = trimmed.split('=');
    if (name && commit) {
      pinned.set(name.trim(), commit.trim());
    }
  }

  for (const [name, expectedCommit] of pinned) {
    const refDir = path.resolve('.ref', name);
    try {
      await stat(refDir);
    } catch {
      continue;
    }
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: refDir });
      const actual = stdout.trim();
      if (actual !== expectedCommit) {
        console.warn(
          `[parity] .ref/${name} is at ${actual.slice(0, 12)} but pinned to ${expectedCommit.slice(0, 12)}. Parity results may differ.`,
        );
      }
    } catch {
      // Not a git repo or git not available
    }
  }
}

export async function buildParity(): Promise<void> {
  await mkdir(path.resolve('.tussel-cache', 'parity'), { recursive: true });
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command = 'run', ...rest] = argv;
  if (command === 'doctor') {
    await doctorParity();
    console.log('parity doctor: ok');
    return;
  }
  if (command === 'build') {
    await buildParity();
    console.log('parity build: ready');
    return;
  }
  if (command === 'list') {
    const fixtures = await loadFixtures();
    for (const fixture of fixtures) {
      console.log(`${fixture.level}\t${fixture.id}\t${fixture.title}`);
    }
    return;
  }
  if (command === 'run') {
    const options = parseRunOptions(rest);
    const results = await runParity(options);
    for (const result of results) {
      const status = result.ok ? 'PASS' : 'FAIL';
      console.log(`${status} ${result.fixture.id}`);
    }
    const hasFailure = results.some((result) => !result.ok);
    if (hasFailure) {
      throw new Error('Parity suite failed');
    }
    return;
  }
  throw new Error(`Unknown parity command: ${command}`);
}

function parseRunOptions(args: string[]): {
  fixtureId?: string;
  level?: number;
  saveArtifacts?: boolean;
} {
  const options: {
    fixtureId?: string;
    level?: number;
    saveArtifacts?: boolean;
  } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--fixture') {
      options.fixtureId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--level') {
      options.level = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--save-artifacts') {
      options.saveArtifacts = true;
    }
  }
  return options;
}

function sourceKindForTarget(
  target: 'strudel' | 'tidal',
  fixturePath?: string,
): 'strudel-js' | 'strudel-mjs' | 'strudel-ts' | 'tidal' {
  if (target === 'tidal') {
    return 'tidal';
  }
  if (fixturePath?.endsWith('.strudel.ts')) {
    return 'strudel-ts';
  }
  if (fixturePath?.endsWith('.strudel.mjs')) {
    return 'strudel-mjs';
  }
  return 'strudel-js';
}
