import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-2/rev',
  importTargets: ['tidal'],
  level: 2,
  sources: {
    tidal: {
      code: `rev $ sound "bd cp"`,
      shape: 'pattern',
    },
  },
  title: 'reverse transform',
} satisfies ParityFixture;
