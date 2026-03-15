import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 4,
  id: 'level-2/iter',
  importTargets: ['tidal'],
  level: 2,
  sources: {
    tidal: {
      code: `note "0 1 2 3" |> iter 4`,
      shape: 'pattern',
    },
  },
  title: 'iter rotates pattern start each cycle',
} satisfies ParityFixture;
