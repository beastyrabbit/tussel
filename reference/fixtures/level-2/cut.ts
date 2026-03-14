import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-2/cut',
  importTargets: ['tidal'],
  level: 2,
  sources: {
    tidal: {
      code: `sound "bd bd" # cut 1`,
      shape: 'pattern',
    },
  },
  title: 'cut control',
} satisfies ParityFixture;
