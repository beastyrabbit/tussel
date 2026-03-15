import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-1/empty-pattern',
  importTargets: ['tidal'],
  level: 1,
  sources: {
    tidal: {
      code: `sound "~"`,
      shape: 'pattern',
    },
  },
  title: 'empty pattern (all rests) produces no events',
} satisfies ParityFixture;
