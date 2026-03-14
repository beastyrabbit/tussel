import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-3/banked-sample-audio',
  importTargets: ['tidal', 'strudel'],
  level: 3,
  samplePack: 'reference/assets/basic-kit',
  sources: {
    strudel: {
      code: `s("bd").bank("crate")`,
      shape: 'pattern',
    },
    tidal: {
      code: `sound "bd" # bank "crate"`,
      shape: 'pattern',
    },
  },
  title: 'banked sample exact wav',
} satisfies ParityFixture;
