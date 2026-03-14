import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-1/pan-control',
  importTargets: ['tidal'],
  level: 1,
  sources: {
    tidal: {
      code: `sound "bd cp" # pan "0 1"`,
      shape: 'pattern',
    },
  },
  title: 'basic control merge with pan',
} satisfies ParityFixture;
