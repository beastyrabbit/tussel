import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 1,
  durationCycles: 4,
  id: 'level-2/palindrome',
  importTargets: ['tidal'],
  level: 2,
  sources: {
    tidal: {
      code: `note "0 1 2 3" |> palindrome`,
      shape: 'pattern',
    },
  },
  title: 'palindrome reverses every other cycle',
} satisfies ParityFixture;
