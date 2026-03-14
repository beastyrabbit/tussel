import { describe, expect, it } from 'vitest';
import { renderStrudelAudio } from './adapters/strudel.js';
import { prepareTusselScene, renderTusselAudio } from './adapters/tussel.js';
import { compareAudio } from './compare-audio.js';
import { buildValueModifiersCases, defaultAudioSamplePack } from './value-modifiers-cases.js';

const cases = buildValueModifiersCases();
const samplePack = defaultAudioSamplePack();

describe('Strudel value modifiers page audio parity', () => {
  it('builds a large case set from the page source', () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
  });

  for (const testCase of cases) {
    it(testCase.id, async () => {
      const prepared = await prepareTusselScene('strudel-js', {
        code: testCase.code,
        shape: 'script',
      });

      const [expectedAudio, actualAudio] = await Promise.all([
        renderStrudelAudio(testCase.code, {
          cps: testCase.cps,
          durationCycles: testCase.durationCycles,
          samplePack,
        }),
        renderTusselAudio(prepared, {
          cps: testCase.cps,
          durationCycles: testCase.durationCycles,
          samplePack,
        }),
      ]);

      const comparison = compareAudio(expectedAudio, actualAudio);
      expect(comparison.ok, JSON.stringify(comparison)).toBe(true);
    });
  }
});
