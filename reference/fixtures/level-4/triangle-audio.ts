import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-4/triangle-audio',
  importTargets: ['tidal', 'strudel'],
  level: 4,
  sources: {
    strudel: {
      code: `s("triangle")`,
      shape: 'pattern',
    },
    tidal: {
      code: `sound "triangle"`,
      shape: 'pattern',
    },
  },
  title: 'triangle exact wav',
} satisfies ParityFixture;
