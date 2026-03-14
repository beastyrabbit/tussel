import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-4/saw-audio',
  importTargets: ['tidal', 'strudel'],
  level: 4,
  sources: {
    strudel: {
      code: `s("saw")`,
      shape: 'pattern',
    },
    tidal: {
      code: `sound "saw"`,
      shape: 'pattern',
    },
  },
  title: 'saw exact wav',
} satisfies ParityFixture;
