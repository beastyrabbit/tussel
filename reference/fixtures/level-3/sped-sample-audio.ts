import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-3/sped-sample-audio',
  importTargets: ['tidal', 'strudel'],
  level: 3,
  samplePack: 'reference/assets/basic-kit',
  sources: {
    strudel: {
      code: `s("sd").speed(2)`,
      shape: 'pattern',
    },
    tidal: {
      code: `sound "sd" # speed 2`,
      shape: 'pattern',
    },
  },
  title: 'sped sample exact wav',
} satisfies ParityFixture;
