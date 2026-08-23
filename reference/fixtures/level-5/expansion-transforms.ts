import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 2,
  id: 'level-5/expansion-transforms',
  importTargets: ['tidal'],
  level: 5,
  sources: {
    tidal: {
      code: `d1 $ stut 2 0.125 0.5 $ sound "bd cp"
d2 $ whenmod 4 3 (fast 2) $ sound "hh*2"
d3 $ striate 4 $ sound "sd"
d4 $ fastspread 1 2 $ sound "cp hh"`,
      shape: 'script',
    },
  },
  title: 'stut echo, whenmod conditional, and striate slicing',
} satisfies ParityFixture;
