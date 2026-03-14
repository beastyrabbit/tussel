import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 0.5,
  durationCycles: 4,
  id: 'level-5/fast-slow-chain',
  importTargets: ['tidal', 'strudel'],
  level: 5,
  sources: {
    strudel: {
      code: `setcps(0.5)
s("bd sd hh rim").fast(2).slow(3).gain(0.7).pan(sine.range(-0.5, 0.5))`,
      shape: 'script',
    },
    tidal: {
      code: `setcps 0.5\nd1 $ slow 3 $ fast 2 $ sound "bd sd hh rim" # gain 0.7`,
      shape: 'script',
    },
  },
  title: 'chained fast/slow transforms with pan signal',
} satisfies ParityFixture;
