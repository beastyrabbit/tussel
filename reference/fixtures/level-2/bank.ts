import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-2/bank',
  importTargets: ['tidal'],
  level: 2,
  sources: {
    tidal: {
      code: `sound "bd" # bank "crate"`,
      shape: 'pattern',
    },
  },
  title: 'bank control',
} satisfies ParityFixture;
