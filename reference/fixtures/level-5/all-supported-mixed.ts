import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 1,
  durationCycles: 2,
  id: 'level-5/all-supported-mixed',
  importTargets: ['tidal', 'strudel'],
  level: 5,
  samplePack: 'reference/assets/basic-kit',
  sources: {
    strudel: {
      code: `stack(s("bd").bank("crate").clip(0.5), s("hh hh hh hh").speed(2).cut(1), n("0 2 4 7").s("square").attack(0.02).release(0.2).pan(0.2).mask("1 0 1 1"), n("7 5 3 0").s("triangle").gain(0.12).hpf(200).rev())`,
      shape: 'script',
    },
    tidal: {
      code: `d1 $ sound "bd" # bank "crate" # clip 0.5\nd2 $ sound "hh hh hh hh" # speed 2 # cut 1\nd3 $ mask "1 0 1 1" $ note "0 2 4 7" # sound "square" # attack 0.02 # release 0.2 # pan 0.2\nd4 $ rev $ note "7 5 3 0" # sound "triangle" # gain 0.12 # hpf 200`,
      shape: 'script',
    },
  },
  title: 'all current supported features mixed',
} satisfies ParityFixture;
