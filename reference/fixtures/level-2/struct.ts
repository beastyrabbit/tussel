import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-2/struct',
  importTargets: ['tidal'],
  level: 2,
  sources: {
    tidal: {
      code: `struct "1 0" $ sound "bd cp"`,
      shape: 'pattern',
    },
  },
  title: 'struct transform',
} satisfies ParityFixture;
