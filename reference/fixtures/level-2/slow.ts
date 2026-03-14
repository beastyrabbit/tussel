import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 2,
  id: 'level-2/slow',
  importTargets: ['tidal'],
  level: 2,
  sources: {
    tidal: {
      code: `slow 2 $ sound "bd cp"`,
      shape: 'pattern',
    },
  },
  title: 'slow transform',
} satisfies ParityFixture;
