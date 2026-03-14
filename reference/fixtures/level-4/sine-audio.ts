import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-4/sine-audio',
  importTargets: ['tidal', 'strudel'],
  level: 4,
  sources: {
    strudel: {
      code: `s("sine")`,
      shape: 'pattern',
    },
    tidal: {
      code: `sound "sine"`,
      shape: 'pattern',
    },
  },
  title: 'sine exact wav',
} satisfies ParityFixture;
