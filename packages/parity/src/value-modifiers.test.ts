import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderStrudelAudio } from './adapters/strudel.js';
import { prepareTusselScene, renderTusselAudio } from './adapters/tussel.js';
import { compareAudioWithTolerance } from './compare-audio.js';
import { buildValueModifiersCases, defaultAudioSamplePack } from './value-modifiers-cases.js';

const cases = buildValueModifiersCases();
const samplePack = defaultAudioSamplePack();
const strudelAvailable = existsSync(path.resolve('.ref/strudel/packages/core/index.mjs'));

/** Maximum number of base cases to run as full audio parity tests. */
const MAX_ACTIVE_BASE_CASES = 5;

/**
 * These tests compare native Tussel audio output against Strudel's audio.
 * A representative subset of base cases is tested with full audio comparison;
 * the remaining cases are skipped with a reason rather than left as todos.
 */
describe('Strudel value modifiers page audio parity', () => {
  it('builds a large case set from the page source', () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
  });

  describe.skipIf(!strudelAvailable)('audio parity against Strudel', () => {
    // Separate base cases from derived (wrapped/combo) cases.
    const baseCases = cases.filter((c) => c.id.startsWith('value-modifiers/base-'));
    const derivedCases = cases.filter((c) => !c.id.startsWith('value-modifiers/base-'));

    // Run the first N base cases as real audio parity tests.
    const activeCases = baseCases.slice(0, MAX_ACTIVE_BASE_CASES);
    const skippedBaseCases = baseCases.slice(MAX_ACTIVE_BASE_CASES);

    for (const testCase of activeCases) {
      it(
        `${testCase.id} (native audio parity)`,
        async () => {
          const prepared = await prepareTusselScene('strudel-js', {
            code: testCase.code,
            shape: 'script',
          });

          const [tusselWav, strudelWav] = await Promise.all([
            renderTusselAudio(prepared, {
              cps: testCase.cps,
              durationCycles: testCase.durationCycles,
              samplePack,
            }),
            renderStrudelAudio(testCase.code, {
              cps: testCase.cps,
              durationCycles: testCase.durationCycles,
              samplePack,
            }),
          ]);

          const result = compareAudioWithTolerance(strudelWav, tusselWav);
          expect(result.ok, `Audio mismatch for ${testCase.id}: ${JSON.stringify(result)}`).toBe(
            true,
          );
        },
        60_000,
      );
    }

    // Remaining base cases -- skip with reason instead of todo.
    for (const testCase of skippedBaseCases) {
      it.skip(`${testCase.id} (native audio parity) -- audio parity not yet verified`);
    }

    // Derived cases (wrapped and combo) -- skip with reason instead of todo.
    for (const testCase of derivedCases) {
      it.skip(
        `${testCase.id} (native audio parity) -- audio parity not yet verified for derived cases`,
      );
    }
  });
});
