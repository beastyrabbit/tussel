import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'tolerance' },
  cps: 0.5,
  durationCycles: 8,
  id: 'level-5/conditional-transforms',
  importTargets: ['strudel'],
  level: 5,
  sources: {
    strudel: {
      code: `setcps(0.5)
s("bd sd hh cp").every(3, x => x.fast(2)).sometimes(x => x.gain(0.5))`,
      shape: 'script',
    },
  },
  title: 'every and sometimes conditional transforms',
} satisfies ParityFixture;
