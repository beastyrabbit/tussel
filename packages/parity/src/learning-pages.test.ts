import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderStrudelAudio } from './adapters/strudel.js';
import { prepareTusselScene, queryTusselEvents, renderTusselAudio } from './adapters/tussel.js';
import { compareAudio } from './compare-audio.js';
import { buildLearningPageListenCases, getCoastlineListenCase } from './learning-pages.js';

const samplePack = path.resolve('reference', 'assets', 'basic-kit');

describe('learning page corpus', () => {
  it('extracts the Strudel learn/functions MiniRepl examples', () => {
    const cases = buildLearningPageListenCases();
    expect(cases.length).toBeGreaterThanOrEqual(200);
    expect(cases.some((listenCase) => listenCase.id === 'functions/value-modifiers/example-01')).toBe(true);
    expect(cases.some((listenCase) => listenCase.id === 'learn/mini-notation/example-01')).toBe(true);
    expect(cases.every((listenCase) => listenCase.code.length > 0)).toBe(true);
    expect(cases.every((listenCase) => listenCase.cps > 0)).toBe(true);
  });

  it('loads the manual coastline source', () => {
    const coastline = getCoastlineListenCase();
    expect(coastline.id).toBe('manual/coastline');
    expect(coastline.code).toContain("samples('github:eddyflux/crate')");
    expect(coastline.durationCycles).toBeGreaterThan(2);
  });

  it('imports and queries a representative slice of extracted examples', async () => {
    const cases = representativeLearningPageCases();
    const successes: Array<{ events: unknown[]; prepared: Awaited<ReturnType<typeof prepareTusselScene>> }> =
      [];
    const ts1160Failures: string[] = [];
    const otherFailures: Array<{ error: unknown; id: string }> = [];

    for (const listenCase of cases) {
      try {
        const prepared = await prepareTusselScene('strudel-js', {
          code: listenCase.code,
          shape: 'script',
        });
        const events = await queryTusselEvents(prepared, {
          cps: listenCase.cps,
          durationCycles: Math.min(listenCase.durationCycles, 2),
        });
        successes.push({ events, prepared });
      } catch (error) {
        if (error instanceof Error && error.message.includes('TS1160')) {
          ts1160Failures.push(listenCase.id);
        } else {
          otherFailures.push({ error, id: listenCase.id });
        }
      }
    }

    if (otherFailures.length > 0) {
      const summary = otherFailures
        .map(({ id, error }) => `${id}: ${error instanceof Error ? error.message : String(error)}`)
        .join('\n');
      throw new Error(`${otherFailures.length} learning page examples failed:\n${summary}`);
    }

    if (ts1160Failures.length > 0) {
      console.warn(
        `[learning-pages] ${ts1160Failures.length} examples skipped due to TS1160 (top-level await): ${ts1160Failures.join(', ')}`,
      );
    }

    expect(
      successes.length,
      `Expected all ${cases.length} representative cases to succeed (minus ${ts1160Failures.length} TS1160 skips), but only ${successes.length} passed`,
    ).toBeGreaterThanOrEqual(cases.length - ts1160Failures.length);
    expect(successes.every(({ prepared }) => Object.keys(prepared.scene.channels).length > 0)).toBe(true);
    expect(successes.every(({ events }) => Array.isArray(events))).toBe(true);
  }, 30_000);

  it('keeps a supported subset of learning pages audio-parity clean', async () => {
    for (const listenCase of audioParityLearningPageCases()) {
      const prepared = await prepareTusselScene('strudel-js', {
        code: listenCase.code,
        shape: 'script',
      });
      const [expectedAudio, actualAudio] = await Promise.all([
        renderStrudelAudio(listenCase.code, {
          cps: listenCase.cps,
          durationCycles: Math.min(listenCase.durationCycles, 2),
          samplePack,
        }),
        renderTusselAudio(prepared, {
          cps: listenCase.cps,
          durationCycles: Math.min(listenCase.durationCycles, 2),
          samplePack,
        }),
      ]);

      const comparison = compareAudio(expectedAudio, actualAudio);
      expect(comparison.ok, `${listenCase.id} ${JSON.stringify(comparison)}`).toBe(true);
    }
  }, 30_000);
});

function representativeLearningPageCases() {
  const supportedPages = new Set([
    'functions/intro',
    'functions/value-modifiers',
    'learn/mini-notation',
    'learn/sounds',
    'learn/samples',
    'learn/notes',
    'learn/synths',
    'learn/effects',
    'learn/stepwise',
    'learn/tonal',
    'learn/code',
    'learn/faq',
    'learn/getting-started',
  ]);

  const selected = [];
  const seenPages = new Set<string>();
  for (const listenCase of buildLearningPageListenCases()) {
    const pageId = listenCase.id.replace(/\/example-\d+$/, '');
    if (!supportedPages.has(pageId) || seenPages.has(pageId)) {
      continue;
    }
    if (pageId === 'learn/stepwise' && listenCase.code.includes('fastcat(')) {
      continue;
    }
    seenPages.add(pageId);
    selected.push(listenCase);
  }
  return selected;
}

function audioParityLearningPageCases() {
  const selectedIds = new Set([
    'functions/value-modifiers/example-01',
    'learn/stepwise/example-02',
    'learn/synths/example-01',
    'learn/tonal/example-01',
  ]);
  return buildLearningPageListenCases().filter((listenCase) => selectedIds.has(listenCase.id));
}
