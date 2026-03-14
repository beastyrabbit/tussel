import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-2/sample-controls',
  importTargets: ['tidal'],
  level: 2,
  sources: {
    tidal: {
      code: `sound "bd" # begin 0.25 # end 0.75 # clip 0.5 # speed 2`,
      shape: 'pattern',
    },
  },
  title: 'begin end clip speed controls',
} satisfies ParityFixture;
