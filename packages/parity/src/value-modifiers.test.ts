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

if (!strudelAvailable) {
  throw new Error(
    'Value-modifiers parity suite requires .ref/strudel checkout. ' +
      'Run `git submodule update --init` or see docs/parity-suite.md.',
  );
}

/**
 * These tests compare native Tussel audio output against Strudel's audio.
 * Every case is executed — there are no skips or todos. If a case fails,
 * it means Tussel's audio renderer diverges from Strudel for that pattern.
 */
describe('Strudel value modifiers page audio parity', () => {
  it('builds a large case set from the page source', () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
  });

  for (const testCase of cases) {
    it(`${testCase.id} (native audio parity)`, async () => {
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
      expect(result.ok, `Audio mismatch for ${testCase.id}: ${JSON.stringify(result)}`).toBe(true);
    }, 60_000);
  }
});
