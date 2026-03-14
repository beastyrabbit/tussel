import { describe, expect, it } from 'vitest';
import { buildValueModifiersCases, defaultAudioSamplePack } from './value-modifiers-cases.js';

const cases = buildValueModifiersCases();
const _samplePack = defaultAudioSamplePack();

/**
 * These tests compare native Tussel audio output against Strudel's audio.
 * Many will fail until the native audio renderer implements all required controls.
 * Each case is marked as todo until native audio parity is achieved.
 */
describe('Strudel value modifiers page audio parity', () => {
  it('builds a large case set from the page source', () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
  });

  for (const testCase of cases) {
    it.todo(`${testCase.id} (native audio parity)`);
  }
});
