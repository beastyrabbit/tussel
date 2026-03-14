import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeStrudelSource } from '@tussel/runtime';
import { describeSnippet, detectCps } from './case-text.js';

export interface ValueModifiersCase {
  code: string;
  cps: number;
  durationCycles: number;
  id: string;
  title: string;
}

const PAGE_PATH = path.resolve('.ref/strudel/website/src/pages/functions/value-modifiers.mdx');
const TUNE_PATTERN = /tune=\{(`([\s\S]*?)`|'([\s\S]*?)'|"([\s\S]*?)")\}/g;
const AUDIO_SAMPLE_PACK = 'reference/assets/basic-kit';

const ROOT_WRAPPERS: Array<{ name: string; wrap: (root: string) => string }> = [
  { name: 'fast-2', wrap: (root) => `(${root}).fast(2)` },
  { name: 'slow-2', wrap: (root) => `(${root}).slow(2)` },
  { name: 'gain-half', wrap: (root) => `(${root}).gain(0.5)` },
  { name: 'room-point2', wrap: (root) => `(${root}).room(0.2)` },
  { name: 'early-125', wrap: (root) => `(${root}).early(0.125)` },
  { name: 'late-125', wrap: (root) => `(${root}).late(0.125)` },
  { name: 'mask-10', wrap: (root) => `(${root}).mask("1 0")` },
  { name: 'struct-1010', wrap: (root) => `(${root}).struct("1 0 1 0")` },
  { name: 'pan-left', wrap: (root) => `(${root}).pan(-0.5)` },
  { name: 'pan-right', wrap: (root) => `(${root}).pan(0.5)` },
  { name: 'lpf-800', wrap: (root) => `(${root}).lpf(800)` },
  { name: 'hpf-200', wrap: (root) => `(${root}).hpf(200)` },
];

export function buildValueModifiersCases(): ValueModifiersCase[] {
  const baseCases = extractBaseCases();
  const derivedCases = [...buildWrappedCases(baseCases), ...buildComboCases(baseCases)];
  return [...baseCases, ...derivedCases];
}

export function defaultAudioSamplePack(): string {
  return AUDIO_SAMPLE_PACK;
}

function extractBaseCases(): ValueModifiersCase[] {
  const text = readFileSync(PAGE_PATH, 'utf8');
  const matches = [...text.matchAll(TUNE_PATTERN)];
  return matches.map((match, index) => {
    const rawCode = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    const normalized = normalizeStrudelSource(rawCode);
    return {
      code: normalized,
      cps: detectCps(normalized),
      durationCycles: minimumAudioDurationCycles(detectCps(normalized)),
      id: `value-modifiers/base-${index + 1}`,
      title: describeSnippet(text, match.index ?? 0, index + 1, 'value modifiers example'),
    } satisfies ValueModifiersCase;
  });
}

function buildWrappedCases(baseCases: ValueModifiersCase[]): ValueModifiersCase[] {
  return baseCases.flatMap((testCase) => {
    const split = splitScript(testCase.code);
    if (!split || !isWrappableRoot(split.root)) {
      return [];
    }

    return ROOT_WRAPPERS.map(({ name, wrap }) => {
      const lines = [...terminateStatements(split.preamble)];
      lines.push(wrap(stripTrailingSemicolon(split.root)));
      const code = lines.join('\n');
      return {
        code,
        cps: detectCps(code),
        durationCycles: minimumAudioDurationCycles(detectCps(code)),
        id: `${testCase.id}/${name}`,
        title: `${testCase.title} ${name}`,
      } satisfies ValueModifiersCase;
    });
  });
}

function buildComboCases(baseCases: ValueModifiersCase[]): ValueModifiersCase[] {
  const combinable = baseCases
    .map((testCase) => ({ split: splitScript(testCase.code), testCase }))
    .filter(
      (
        entry,
      ): entry is {
        split: ReturnType<typeof splitScript> extends infer T ? Exclude<T, null> : never;
        testCase: ValueModifiersCase;
      } => !!entry.split,
    )
    .slice(0, 10);

  const results: ValueModifiersCase[] = [];
  for (let index = 0; index < combinable.length - 1; index += 1) {
    const left = combinable[index];
    const right = combinable[index + 1];
    if (!left || !right) {
      continue;
    }
    const preamble = dedupeLines([...left.split.preamble, ...right.split.preamble]);
    const code = [
      ...terminateStatements(preamble),
      `stack((${stripTrailingSemicolon(left.split.root)}), (${stripTrailingSemicolon(right.split.root)}))`,
    ].join('\n');
    results.push({
      code,
      cps: detectCps(code),
      durationCycles: minimumAudioDurationCycles(detectCps(code)),
      id: `value-modifiers/combo-${index + 1}`,
      title: `${left.testCase.title} + ${right.testCase.title}`,
    });
  }
  return results;
}

function splitScript(code: string): { preamble: string[]; root: string } | null {
  const lines = code.split('\n');
  const lastTopLevelIndex = findLastTopLevelLine(lines);
  if (lastTopLevelIndex === -1) {
    return null;
  }

  const preamble = trimTrailingBlankLines(lines.slice(0, lastTopLevelIndex));
  const root = lines.slice(lastTopLevelIndex).join('\n').trim();
  return root ? { preamble, root } : null;
}

function isWrappableRoot(root: string): boolean {
  const trimmed = root.trim();
  if (!trimmed) {
    return false;
  }

  if (
    (trimmed.startsWith('"') || trimmed.startsWith("'") || trimmed.startsWith('`')) &&
    !trimmed.includes('.add(')
  ) {
    return false;
  }

  return true;
}

function findLastTopLevelLine(lines: string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const trimmed = line?.trim() ?? '';
    if (!trimmed || trimmed.startsWith('//')) {
      continue;
    }
    if (!line?.startsWith(' ') && !line?.startsWith('\t') && !trimmed.startsWith('.')) {
      return index;
    }
  }
  return -1;
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const result = [...lines];
  while (result.length > 0 && result.at(-1)?.trim() === '') {
    result.pop();
  }
  return result;
}

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      continue;
    }
    if (seen.has(line)) {
      continue;
    }
    seen.add(line);
    result.push(line);
  }
  return result;
}

function terminateStatements(lines: string[]): string[] {
  return lines.map((line) => {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('//') ||
      trimmed.endsWith(';') ||
      trimmed.endsWith('{') ||
      trimmed.endsWith('}')
    ) {
      return line;
    }
    return `${line};`;
  });
}

function stripTrailingSemicolon(value: string): string {
  return value.trim().replace(/;$/, '');
}

function minimumAudioDurationCycles(cps: number): number {
  return Math.max(2, Math.ceil(cps * 10));
}
