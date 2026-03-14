import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-3/two-channel-layer-audio',
  importTargets: ['tidal', 'strudel'],
  level: 3,
  samplePack: 'reference/assets/basic-kit',
  sources: {
    strudel: {
      code: `stack(s("bd").bank("crate"), s("hh hh hh hh").gain(0.5))`,
      shape: 'script',
    },
    tidal: {
      code: `d1 $ sound "bd" # bank "crate"\n d2 $ sound "hh hh hh hh" # gain 0.5`,
      shape: 'script',
    },
  },
  title: 'two channel sample layer exact wav parity',
} satisfies ParityFixture;
