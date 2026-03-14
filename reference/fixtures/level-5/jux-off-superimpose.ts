import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'tolerance' },
  cps: 0.5,
  durationCycles: 4,
  id: 'level-5/jux-off-superimpose',
  importTargets: ['strudel'],
  level: 5,
  sources: {
    strudel: {
      code: `setcps(0.5)
s("bd sd hh cp").off(0.125, x => x.gain(0.3)).jux(x => x.fast(2))`,
      shape: 'script',
    },
  },
  title: 'jux and off layering transforms',
} satisfies ParityFixture;
