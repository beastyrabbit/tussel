import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-1/rests',
  importTargets: ['tidal'],
  level: 1,
  sources: {
    tidal: {
      code: `sound "bd ~ cp"`,
      shape: 'pattern',
    },
  },
  title: 'rest handling',
} satisfies ParityFixture;
