import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 0.75,
  durationCycles: 2,
  id: 'level-5/coastline-subset',
  importTargets: ['tidal', 'strudel'],
  level: 5,
  samplePack: 'reference/assets/basic-kit',
  sources: {
    strudel: {
      code: `setcps(0.75)
stack(s("bd ~ rim sd").bank("crate").mask("1 1 0 1"), s("hh hh hh hh").gain(0.5).late(0.01), n("0 0 3 5").s("saw").slow(2).lpf(700).release(0.3), n("7 5 3 0").s("triangle").gain(0.15).early(0.125))`,
      shape: 'script',
    },
    tidal: {
      code: `setcps 0.75\nd1 $ mask "1 1 0 1" $ sound "bd ~ rim sd" # bank "crate"\nd2 $ late 0.01 $ sound "hh hh hh hh" # gain 0.5\nd3 $ slow 2 $ note "0 0 3 5" # sound "saw" # lpf 700 # release 0.3\nd4 $ early 0.125 $ note "7 5 3 0" # sound "triangle" # gain 0.15`,
      shape: 'script',
    },
  },
  title: 'coastline style supported subset',
} satisfies ParityFixture;
