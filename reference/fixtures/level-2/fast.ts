import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-2/fast',
  importTargets: ['tidal'],
  level: 2,
  sources: {
    tidal: {
      code: `fast 2 $ sound "bd cp"`,
      shape: 'pattern',
    },
  },
  title: 'fast transform',
} satisfies ParityFixture;
