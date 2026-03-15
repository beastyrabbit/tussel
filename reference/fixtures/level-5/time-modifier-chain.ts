import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'tolerance' },
  cps: 0.5,
  durationCycles: 8,
  id: 'level-5/time-modifier-chain',
  importTargets: ['strudel'],
  level: 5,
  sources: {
    strudel: {
      code: `note("c3 e3 g3 b3")
  .fast(2)
  .palindrome()
  .iter(4)
  .gain(0.6)
  .s("sawtooth")
  .room(0.2)
  .lpf(2000)`,
      shape: 'script',
    },
  },
  title: 'chained time modifiers: fast + palindrome + iter with effects',
} satisfies ParityFixture;
