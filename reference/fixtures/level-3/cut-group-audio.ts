import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-3/cut-group-audio',
  importTargets: ['tidal', 'strudel'],
  level: 3,
  samplePack: 'reference/assets/basic-kit',
  sources: {
    strudel: {
      code: `s("bd bd").fast(2).cut(1).speed(0.5)`,
      shape: 'pattern',
    },
    tidal: {
      code: `fast 2 $ sound "bd bd" # cut 1 # speed 0.5`,
      shape: 'pattern',
    },
  },
  title: 'cut group exact wav',
} satisfies ParityFixture;
