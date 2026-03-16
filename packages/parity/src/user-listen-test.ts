#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureSamplePackLocal, renderSceneToWavBuffer } from '@tussel/audio';
import { resolveTusselCacheDir, stableJson } from '@tussel/ir';
import { renderStrudelAudio } from './adapters/strudel.js';
import { prepareTusselScene, readCanonicalScene, renderTusselAudio } from './adapters/tussel.js';
import { compareAudio, isAudibleWav } from './compare-audio.js';
import { buildLearningPageListenCases, getCoastlineListenCase, type ListenCase } from './learning-pages.js';

interface GeneratedListenResult {
  caseId: string;
  comparisons: {
    native?: ReturnType<typeof compareAudio>;
    roundtrip?: ReturnType<typeof compareAudio>;
  };
  errors: string[];
  ok: boolean;
  outputDir: string;
  sourcePath: string;
  status: 'diff' | 'match' | 'partial' | 'silent';
  title: string;
}

// biome-ignore lint/complexity/useRegexLiterals: constructor form avoids the control-character regex-literal lint.
const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const outputDir = path.resolve(
    options.outputDir ?? path.join(resolveTusselCacheDir('user-listen-test'), 'latest'),
  );
  const cases = selectCases(options);

  await rm(outputDir, { force: true, recursive: true });
  await mkdir(outputDir, { recursive: true });

  const results: GeneratedListenResult[] = [];
  await withSuppressedRenderNoise(async () => {
    for (const listenCase of cases) {
      const result = await generateListenCase(listenCase, outputDir);
      results.push(result);
      if (options.all || isVisibleListenResult(result)) {
        console.log(`${result.status.toUpperCase()} ${listenCase.id}`);
      }
    }
  });

  const summary = {
    audibleDiffs: results.filter((result) => result.status === 'diff').length,
    audibleMatches: results.filter((result) => result.status === 'match').length,
    cases: results.length,
    errors: results.filter((result) => result.status === 'partial').length,
    nativeExactMatches: results.filter((result) => result.comparisons.native?.ok).length,
    nativeMismatches: results.filter((result) => result.comparisons.native && !result.comparisons.native.ok)
      .length,
    partials: results.filter((result) => result.status === 'partial').length,
    roundtripExactMatches: results.filter((result) => result.comparisons.roundtrip?.ok).length,
    roundtripMismatches: results.filter(
      (result) => result.comparisons.roundtrip && !result.comparisons.roundtrip.ok,
    ).length,
    silent: results.filter((result) => result.status === 'silent').length,
    outputDir,
  };

  await relocateRejectedResults(outputDir, results, options.all ?? false);
  await writeManifest(
    outputDir,
    options.all ? results : results.filter((result) => isVisibleListenResult(result)),
    summary,
  );
  const firstListenFile = await writeListenMixes(
    options.all ? results : results.filter((result) => isVisibleListenResult(result)),
    outputDir,
  );

  console.log(`listen files written to ${outputDir}`);
  if (firstListenFile) {
    console.log(`first listen file: ${firstListenFile}`);
  }
  console.log(stableJson(summary));

  if ((options.play || (options.play !== false && cases.length === 1)) && firstListenFile) {
    await maybePlayFile(firstListenFile);
  }

  if (
    options.strict &&
    (summary.errors > 0 ||
      summary.nativeMismatches > 0 ||
      summary.roundtripMismatches > 0 ||
      summary.silent > 0)
  ) {
    process.exitCode = 1;
  }
}

async function generateListenCase(listenCase: ListenCase, rootDir: string): Promise<GeneratedListenResult> {
  const outputDir = path.join(rootDir, sanitizeSegment(listenCase.id));
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'source.strudel.js'), `${listenCase.code}\n`);

  const errors: string[] = [];
  const seconds = listenCase.durationCycles / listenCase.cps;
  let prepared: Awaited<ReturnType<typeof prepareTusselScene>> | undefined;
  let samplePack: string | undefined;

  try {
    prepared = await prepareTusselScene('strudel-js', {
      code: listenCase.code,
      shape: 'script',
    });
    await writeFile(path.join(outputDir, 'canonical.scene.ts'), await readCanonicalScene(prepared));
    const sampleRef = prepared.scene.samples[0]?.ref;
    samplePack = sampleRef ? await ensureSamplePackLocal(sampleRef) : undefined;
  } catch (error) {
    errors.push(`prepare: ${(error as Error).message}`);
  }

  let referenceAudio: Buffer | undefined;
  try {
    referenceAudio = await renderStrudelAudio(listenCase.code, {
      cps: listenCase.cps,
      durationCycles: listenCase.durationCycles,
      samplePack,
    });
    await writeFile(path.join(outputDir, 'reference-strudel.wav'), referenceAudio);
  } catch (error) {
    errors.push(`reference: ${(error as Error).message}`);
  }

  let roundtripAudio: Buffer | undefined;
  if (prepared) {
    try {
      roundtripAudio = await renderTusselAudio(prepared, {
        cps: listenCase.cps,
        durationCycles: listenCase.durationCycles,
        samplePack,
      });
      await writeFile(path.join(outputDir, 'tussel-roundtrip.wav'), roundtripAudio);
      await writeComparisonListenFile(
        outputDir,
        'listen-reference-vs-roundtrip.wav',
        referenceAudio,
        roundtripAudio,
      );
    } catch (error) {
      errors.push(`roundtrip: ${(error as Error).message}`);
    }
  }

  let nativeAudio: Buffer | undefined;
  if (prepared) {
    try {
      nativeAudio = await renderSceneToWavBuffer(prepared.scene, { seconds });
      await writeFile(path.join(outputDir, 'tussel-native.wav'), nativeAudio);
      await writeComparisonListenFile(
        outputDir,
        'listen-reference-vs-native.wav',
        referenceAudio,
        nativeAudio,
      );
    } catch (error) {
      errors.push(`native: ${(error as Error).message}`);
    }
  }

  const comparisons: GeneratedListenResult['comparisons'] = {};
  if (referenceAudio && roundtripAudio) {
    comparisons.roundtrip = compareAudio(referenceAudio, roundtripAudio);
    await writeFile(path.join(outputDir, 'comparison.roundtrip.json'), stableJson(comparisons.roundtrip));
  }
  if (referenceAudio && nativeAudio) {
    comparisons.native = compareAudio(referenceAudio, nativeAudio);
    await writeFile(path.join(outputDir, 'comparison.native.json'), stableJson(comparisons.native));
  }

  await writeFile(
    path.join(outputDir, 'meta.json'),
    stableJson({
      cps: listenCase.cps,
      durationCycles: listenCase.durationCycles,
      errors,
      files: {
        canonicalScene: prepared ? 'canonical.scene.ts' : undefined,
        referenceAudio: referenceAudio ? 'reference-strudel.wav' : undefined,
        tusselNative: nativeAudio ? 'tussel-native.wav' : undefined,
        tusselRoundtrip: roundtripAudio ? 'tussel-roundtrip.wav' : undefined,
      },
      origin: listenCase.origin,
      samplePack,
      sourcePath: listenCase.sourcePath,
      title: listenCase.title,
    }),
  );

  if (errors.length > 0) {
    await writeFile(path.join(outputDir, 'error.txt'), `${errors.join('\n')}\n`);
  }

  const status = classifyListenResult({ comparisons, errors, nativeAudio, referenceAudio, roundtripAudio });

  return {
    caseId: listenCase.id,
    comparisons,
    errors,
    ok: status === 'match' || status === 'diff',
    outputDir,
    sourcePath: listenCase.sourcePath,
    status,
    title: listenCase.title,
  };
}

async function writeManifest(
  outputDir: string,
  results: GeneratedListenResult[],
  summary: Record<string, number | string>,
): Promise<void> {
  await writeFile(path.join(outputDir, 'index.json'), stableJson(results));
  await writeFile(
    path.join(outputDir, 'index.md'),
    [
      '# User Listen Test',
      '',
      'Summary:',
      ...Object.entries(summary).map(([key, value]) => `- ${key}: ${value}`),
      '',
      'Each case directory contains:',
      '- `source.strudel.js`',
      '- `canonical.scene.ts` when import succeeded',
      '- `reference-strudel.wav`',
      '- `tussel-roundtrip.wav` when Tussel import succeeded',
      '- `tussel-native.wav`',
      '- `listen-reference-vs-roundtrip.wav` when both outputs are audible',
      '- `listen-reference-vs-native.wav` when both outputs are audible',
      '- `comparison.roundtrip.json` when available',
      '- `comparison.native.json` when available',
      '- `error.txt` when generation failed',
      '',
      ...results.map((result) => {
        const relativeDir = path.relative(outputDir, result.outputDir).replaceAll(path.sep, '/');
        return [
          `## ${result.caseId}`,
          '',
          `- title: ${result.title}`,
          `- status: ${result.status.toUpperCase()}`,
          `- source: ${result.sourcePath}`,
          `- dir: ${relativeDir}`,
          ...(result.comparisons.roundtrip
            ? [
                `- roundtrip first mismatch sample: ${result.comparisons.roundtrip.firstMismatchSample ?? 'none'}`,
                `- roundtrip max absolute delta: ${result.comparisons.roundtrip.maxAbsoluteDelta ?? 0}`,
                `- roundtrip rms delta: ${result.comparisons.roundtrip.rmsDelta ?? 0}`,
              ]
            : []),
          ...(result.comparisons.native
            ? [
                `- native first mismatch sample: ${result.comparisons.native.firstMismatchSample ?? 'none'}`,
                `- native max absolute delta: ${result.comparisons.native.maxAbsoluteDelta ?? 0}`,
                `- native rms delta: ${result.comparisons.native.rmsDelta ?? 0}`,
              ]
            : []),
          ...result.errors.map((error) => `- error: ${error}`),
          '',
        ].join('\n');
      }),
    ].join('\n'),
  );
}

export function selectCases(options: {
  filter?: string;
  limit?: number;
  only?: 'all' | 'coastline' | 'learning';
}): ListenCase[] {
  const cases = [
    ...(options.only === 'learning' ? [] : [getCoastlineListenCase()]),
    ...(options.only === 'coastline' ? [] : buildLearningPageListenCases()),
  ];

  const filtered = options.filter
    ? cases.filter(
        (listenCase) =>
          listenCase.id.includes(options.filter ?? '') || listenCase.title.includes(options.filter ?? ''),
      )
    : cases;

  return typeof options.limit === 'number' ? filtered.slice(0, options.limit) : filtered;
}

export function parseArgs(args: string[]): {
  all?: boolean;
  filter?: string;
  limit?: number;
  only?: 'all' | 'coastline' | 'learning';
  outputDir?: string;
  play?: boolean;
  strict?: boolean;
} {
  const options: {
    all?: boolean;
    filter?: string;
    limit?: number;
    only?: 'all' | 'coastline' | 'learning';
    outputDir?: string;
    play?: boolean;
    strict?: boolean;
  } = {
    only: 'all',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }
    if (arg === '--filter') {
      options.filter = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--limit') {
      options.limit = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--only') {
      const value = args[index + 1];
      if (value === 'all' || value === 'coastline' || value === 'learning') {
        options.only = value;
      }
      index += 1;
      continue;
    }
    if (arg === '--out') {
      options.outputDir = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg === '--play') {
      options.play = true;
      continue;
    }
    if (arg === '--no-play') {
      options.play = false;
      continue;
    }
    if (arg === '--all') {
      options.all = true;
    }
  }

  return options;
}

function classifyListenResult(input: {
  comparisons: GeneratedListenResult['comparisons'];
  errors: string[];
  nativeAudio?: Buffer;
  referenceAudio?: Buffer;
  roundtripAudio?: Buffer;
}): GeneratedListenResult['status'] {
  if (input.errors.length > 0) {
    return 'partial';
  }

  const audible =
    isAudibleWav(input.referenceAudio) ||
    isAudibleWav(input.roundtripAudio) ||
    isAudibleWav(input.nativeAudio);
  if (!audible) {
    return 'silent';
  }

  if (input.comparisons.native) {
    return input.comparisons.native.ok ? 'match' : 'diff';
  }
  if (input.comparisons.roundtrip) {
    return input.comparisons.roundtrip.ok ? 'match' : 'diff';
  }
  return 'silent';
}

function isVisibleListenResult(result: GeneratedListenResult): boolean {
  return result.status === 'match' || result.status === 'diff';
}

async function relocateRejectedResults(
  outputDir: string,
  results: GeneratedListenResult[],
  includeRejected: boolean,
): Promise<void> {
  if (includeRejected) {
    return;
  }

  const rejected = results.filter((result) => !isVisibleListenResult(result));
  if (rejected.length === 0) {
    return;
  }

  const rejectedRoot = path.join(outputDir, '_rejected');
  await mkdir(rejectedRoot, { recursive: true });

  for (const result of rejected) {
    const targetDir = path.join(rejectedRoot, path.basename(result.outputDir));
    await rename(result.outputDir, targetDir);
    result.outputDir = targetDir;
  }
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^\w.-]+/g, '_');
}

async function writeListenMixes(
  results: GeneratedListenResult[],
  outputDir: string,
): Promise<string | undefined> {
  const first = results.find((result) => result.status === 'match' || result.status === 'diff');
  if (!first) {
    return undefined;
  }

  const nativePath = path.join(first.outputDir, 'listen-reference-vs-native.wav');
  const roundtripPath = path.join(first.outputDir, 'listen-reference-vs-roundtrip.wav');
  for (const candidatePath of first.comparisons.native
    ? [nativePath, roundtripPath]
    : [roundtripPath, nativePath]) {
    const bytes = await readFileMaybe(candidatePath);
    if (!bytes) {
      continue;
    }
    const targetPath = path.join(outputDir, path.basename(candidatePath));
    await writeFile(targetPath, bytes);
    return targetPath;
  }
  return undefined;
}

async function writeComparisonListenFile(
  outputDir: string,
  fileName: string,
  referenceAudio: Buffer | undefined,
  actualAudio: Buffer | undefined,
): Promise<void> {
  if (!referenceAudio || !actualAudio || !isAudibleWav(referenceAudio) || !isAudibleWav(actualAudio)) {
    return;
  }

  const combined = concatenateCanonicalWavs([referenceAudio, createSilenceWav(0.75), actualAudio]);
  await writeFile(path.join(outputDir, fileName), combined);
}

function createSilenceWav(seconds: number): Buffer {
  const frameCount = Math.max(1, Math.ceil(48_000 * seconds));
  return encodeCanonicalWav(48_000, 2, Buffer.alloc(frameCount * 2 * 2));
}

function concatenateCanonicalWavs(buffers: Buffer[]): Buffer {
  const parsed = buffers.map((buffer) => parseCanonicalWav(buffer));
  const sampleRate = parsed[0]?.sampleRate ?? 48_000;
  const channels = parsed[0]?.channels ?? 2;
  for (const wav of parsed) {
    if (wav.sampleRate !== sampleRate || wav.channels !== channels) {
      throw new Error('Expected canonical stereo 48k WAV data for listen output.');
    }
  }
  return encodeCanonicalWav(sampleRate, channels, Buffer.concat(parsed.map((wav) => wav.data)));
}

function parseCanonicalWav(buffer: Buffer): { channels: number; data: Buffer; sampleRate: number } {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Expected canonical RIFF/WAVE listen data.');
  }
  return {
    channels: buffer.readUInt16LE(22),
    data: buffer.subarray(44),
    sampleRate: buffer.readUInt32LE(24),
  };
}

function encodeCanonicalWav(sampleRate: number, channels: number, data: Buffer): Buffer {
  const result = Buffer.alloc(data.byteLength + 44);
  result.write('RIFF', 0, 'ascii');
  result.writeUInt32LE(result.byteLength - 8, 4);
  result.write('WAVE', 8, 'ascii');
  result.write('fmt ', 12, 'ascii');
  result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20);
  result.writeUInt16LE(channels, 22);
  result.writeUInt32LE(sampleRate, 24);
  result.writeUInt32LE(sampleRate * channels * 2, 28);
  result.writeUInt16LE(channels * 2, 32);
  result.writeUInt16LE(16, 34);
  result.write('data', 36, 'ascii');
  result.writeUInt32LE(data.byteLength, 40);
  data.copy(result, 44);
  return result;
}

async function maybePlayFile(filePath: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return;
  }

  await new Promise<void>((resolve) => {
    const child = spawn('ffplay', ['-autoexit', '-nodisp', filePath], { stdio: 'inherit' });
    child.once('error', () => resolve());
    child.once('exit', () => resolve());
  });
}

async function readFileMaybe(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch {
    return undefined;
  }
}

async function withSuppressedRenderNoise<T>(work: () => Promise<T>): Promise<T> {
  const suppress = (values: unknown[]) => {
    const text = stripAnsi(values.map((value) => `${value}`).join(' ')).trim();
    return (
      text === 'cannot use window: not in browser?' ||
      text === '🌀 @strudel/core loaded 🌀' ||
      text.startsWith('sample not found:') ||
      text.startsWith('sound not loaded')
    );
  };

  const originalError = console.error;
  const originalLog = console.log;
  const originalWarn = console.warn;

  console.error = (...values: unknown[]) => {
    if (!suppress(values)) {
      originalError(...values);
    }
  };
  console.log = (...values: unknown[]) => {
    if (!suppress(values)) {
      originalLog(...values);
    }
  };
  console.warn = (...values: unknown[]) => {
    if (!suppress(values)) {
      originalWarn(...values);
    }
  };

  try {
    return await work();
  } finally {
    console.error = originalError;
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error((error as Error).stack ?? (error as Error).message);
    process.exitCode = 1;
  });
}
