import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-2/gain-zero',
  importTargets: ['tidal'],
  level: 2,
  sources: {
    tidal: {
      code: `sound "bd" # gain 0`,
      shape: 'pattern',
    },
  },
  title: 'gain 0 produces event with zero gain',
} satisfies ParityFixture;
