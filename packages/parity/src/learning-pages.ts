import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeStrudelSource } from '@tussel/runtime';
import { describeSnippet, detectCps } from './case-text.js';

export interface ListenCase {
  code: string;
  cps: number;
  durationCycles: number;
  id: string;
  origin: 'learning-page' | 'manual';
  sourcePath: string;
  title: string;
}

const PAGE_ROOT = path.resolve('.ref/strudel/website/src/pages');
const LEARNING_PAGE_DIRS = ['functions', 'learn'] as const;
const MINI_REPL_TUNE_PATTERN = /<MiniRepl[^>]*?tune=\{(`([\s\S]*?)`|'([\s\S]*?)'|"([\s\S]*?)")\}[^>]*\/?>/g;
const DEFAULT_LISTEN_SECONDS = 10;
const COASTLINE_LISTEN_SECONDS = 24;

export function buildLearningPageListenCases(): ListenCase[] {
  const cases: ListenCase[] = [];
  for (const relativeDir of LEARNING_PAGE_DIRS) {
    const directory = path.join(PAGE_ROOT, relativeDir);
    for (const sourcePath of listMdxFiles(directory)) {
      cases.push(...extractMiniReplCases(sourcePath));
    }
  }
  return cases.sort((left, right) => left.id.localeCompare(right.id));
}

export function getCoastlineListenCase(): ListenCase {
  const sourcePath = path.resolve('examples', 'manual-listen', 'coastline.strudel.js');
  const code = normalizeStrudelSource(readFileSync(sourcePath, 'utf8').trim());
  const cps = detectCps(code);
  return {
    code,
    cps,
    durationCycles: secondsToCycles(cps, COASTLINE_LISTEN_SECONDS),
    id: 'manual/coastline',
    origin: 'manual',
    sourcePath,
    title: 'coastline',
  };
}

function extractMiniReplCases(sourcePath: string): ListenCase[] {
  const text = readFileSync(sourcePath, 'utf8');
  const relativePath = path.relative(PAGE_ROOT, sourcePath).replaceAll(path.sep, '/');
  const matches = [...text.matchAll(MINI_REPL_TUNE_PATTERN)];

  return matches.map((match, index) => {
    const rawCode = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    const code = normalizeStrudelSource(rawCode);
    const cps = detectCps(code);
    const heading = describeSnippet(text, match.index ?? 0, index + 1, 'learning example');
    const pageId = relativePath.replace(/\.mdx$/, '');

    return {
      code,
      cps,
      durationCycles: secondsToCycles(cps, DEFAULT_LISTEN_SECONDS),
      id: `${pageId}/example-${String(index + 1).padStart(2, '0')}`,
      origin: 'learning-page',
      sourcePath,
      title: `${heading} (${relativePath} #${index + 1})`,
    } satisfies ListenCase;
  });
}

function listMdxFiles(rootDir: string): string[] {
  return readDirectoryRecursive(rootDir)
    .filter((entry) => entry.endsWith('.mdx'))
    .sort((left, right) => left.localeCompare(right));
}

function readDirectoryRecursive(rootDir: string): string[] {
  const dirEntries = readdirSync(rootDir, { withFileTypes: true }) as Array<{
    isDirectory(): boolean;
    name: string;
  }>;

  return dirEntries.flatMap((entry) => {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      return readDirectoryRecursive(entryPath);
    }
    return [entryPath];
  });
}

function secondsToCycles(cps: number, seconds: number): number {
  return Number(Math.max(2, cps * seconds).toFixed(3));
}
