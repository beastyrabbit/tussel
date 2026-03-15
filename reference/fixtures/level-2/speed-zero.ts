import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-2/speed-zero',
  importTargets: ['tidal'],
  level: 2,
  sources: {
    tidal: {
      code: `sound "bd" # speed 0`,
      shape: 'pattern',
    },
  },
  title: 'speed 0 produces event with zero speed',
} satisfies ParityFixture;
