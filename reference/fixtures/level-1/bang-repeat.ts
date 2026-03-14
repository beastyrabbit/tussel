import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-1/bang-repeat',
  importTargets: ['tidal'],
  level: 1,
  sources: {
    tidal: {
      code: `sound "bd!2 cp"`,
      shape: 'pattern',
    },
  },
  title: 'bang replication',
} satisfies ParityFixture;
