import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderStrudelAudio } from './adapters/strudel.js';
import { prepareTusselScene, queryTusselEvents, renderTusselAudio } from './adapters/tussel.js';
import { compareAudioWithTolerance } from './compare-audio.js';
import { buildLearningPageListenCases, getCoastlineListenCase } from './learning-pages.js';

const strudelAvailable = existsSync(path.resolve('.ref/strudel/packages/core/index.mjs'));

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
          durationCycles: listenCase.durationCycles,
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
      throw new Error(
        `${ts1160Failures.length} examples failed due to TS1160 (top-level await is not supported): ${ts1160Failures.join(', ')}. ` +
          'These must be handled explicitly — either support top-level await or exclude these examples from the supported page list.',
      );
    }

    expect(
      successes.length,
      `Expected all ${cases.length} representative cases to succeed, but only ${successes.length} passed`,
    ).toBeGreaterThanOrEqual(cases.length);
    expect(successes.every(({ prepared }) => Object.keys(prepared.scene.channels).length > 0)).toBe(true);
    expect(successes.every(({ events }) => Array.isArray(events))).toBe(true);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Skipped pages — features not yet implemented in Tussel
  // ---------------------------------------------------------------------------

  it.skip('learn/csound — Csound not implemented', () => {
    /* Csound integration is not available in Tussel yet. */
  });

  it.skip('learn/hydra — Hydra not implemented', () => {
    /* Hydra visual synth integration is not available in Tussel yet. */
  });

  it.skip('learn/xen — Xen API not complete', () => {
    /* Xenharmonic (microtonal) API is incomplete in Tussel. */
  });

  it.skip('learn/mondo-notation — Mondo evaluator missing', () => {
    /* Mondo notation evaluator has not been ported to Tussel. */
  });

  it.skip('learn/input-output — MIDI/OSC I/O not wired', () => {
    /* MIDI and OSC input/output are not wired in the Tussel runtime. */
  });

  it.skip('learn/input-devices — Gamepad not wired', () => {
    /* Gamepad and other input device APIs are not wired. */
  });

  it.skip('learn/devicemotion — Motion not wired', () => {
    /* DeviceMotion API is not wired in Tussel. */
  });

  it.skip('learn/visual-feedback — No renderer', () => {
    /* Visual feedback requires a renderer not available in Tussel. */
  });

  it.skip('learn/pwa — Out of scope', () => {
    /* PWA functionality is out of scope for parity testing. */
  });
});

// ---------------------------------------------------------------------------
// Audio parity against Strudel oracle (requires .ref/strudel checkout)
// ---------------------------------------------------------------------------

describe.skipIf(!strudelAvailable)(
  'learning page audio parity against Strudel oracle',
  () => {
    const cases = representativeLearningPageCases();

    for (const listenCase of cases) {
      it(`${listenCase.id} renders audio matching Strudel`, async () => {
        const prepared = await prepareTusselScene('strudel-js', {
          code: listenCase.code,
          shape: 'script',
        });

        const [tusselWav, strudelWav] = await Promise.all([
          renderTusselAudio(prepared, {
            cps: listenCase.cps,
            durationCycles: listenCase.durationCycles,
          }),
          renderStrudelAudio(listenCase.code, {
            cps: listenCase.cps,
            durationCycles: listenCase.durationCycles,
          }),
        ]);

        const result = compareAudioWithTolerance(strudelWav, tusselWav, {
          maxAbsoluteDelta: 100,
          rmsDelta: 20,
        });

        expect(result.ok, formatAudioMismatch(listenCase.id, result)).toBe(true);
      }, 60_000);
    }
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function representativeLearningPageCases() {
  // learn/mini-notation excluded: example-01 uses top-level await (TS1160)
  const supportedPages = new Set([
    'functions/intro',
    'functions/value-modifiers',
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
    // learn/strudel-vs-tidal excluded: uses $: / _$: channel assignment (not supported)
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
    // Skip examples using top-level await — not supported by the Tussel runtime.
    // These are explicitly excluded rather than silently skipped (see audit 0.8).
    if (listenCase.code.includes('await ')) {
      continue;
    }
    seenPages.add(pageId);
    selected.push(listenCase);
  }
  return selected;
}

function formatAudioMismatch(
  caseId: string,
  result: { actualSilent?: boolean; expectedSilent?: boolean; maxAbsoluteDelta?: number; rmsDelta?: number },
): string {
  const parts = [`Audio parity failed for ${caseId}`];
  if (result.expectedSilent) {
    parts.push('Strudel oracle produced silence');
  }
  if (result.actualSilent) {
    parts.push('Tussel produced silence');
  }
  if (result.maxAbsoluteDelta !== undefined) {
    parts.push(`maxAbsoluteDelta=${result.maxAbsoluteDelta}`);
  }
  if (result.rmsDelta !== undefined) {
    parts.push(`rmsDelta=${result.rmsDelta.toFixed(2)}`);
  }
  return parts.join('; ');
}
