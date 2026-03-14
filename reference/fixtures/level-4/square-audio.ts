import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-4/square-audio',
  importTargets: ['tidal', 'strudel'],
  level: 4,
  sources: {
    strudel: {
      code: `s("square")`,
      shape: 'pattern',
    },
    tidal: {
      code: `sound "square"`,
      shape: 'pattern',
    },
  },
  title: 'square exact wav',
} satisfies ParityFixture;
