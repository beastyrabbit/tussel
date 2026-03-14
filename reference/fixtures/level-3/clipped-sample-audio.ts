import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-3/clipped-sample-audio',
  importTargets: ['tidal', 'strudel'],
  level: 3,
  samplePack: 'reference/assets/basic-kit',
  sources: {
    strudel: {
      code: `s("bd").begin(0.25).end(0.75).clip(0.5)`,
      shape: 'pattern',
    },
    tidal: {
      code: `sound "bd" # begin 0.25 # end 0.75 # clip 0.5`,
      shape: 'pattern',
    },
  },
  title: 'clipped sample exact wav',
} satisfies ParityFixture;
