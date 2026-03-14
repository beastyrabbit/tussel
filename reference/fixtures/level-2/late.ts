import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 2,
  id: 'level-2/late',
  importTargets: ['tidal'],
  level: 2,
  sources: {
    tidal: {
      code: `late 0.25 $ sound "bd cp"`,
      shape: 'pattern',
    },
  },
  title: 'late transform',
} satisfies ParityFixture;
