import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 2,
  id: 'level-1/silence',
  importTargets: ['tidal'],
  level: 1,
  sources: {
    tidal: {
      code: `sound "~ ~ ~ ~"`,
      shape: 'pattern',
    },
  },
  title: 'all-rest pattern is silent across multiple cycles',
} satisfies ParityFixture;
