import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 0.5,
  durationCycles: 2,
  id: 'level-5/mixed-integration',
  importTargets: ['tidal', 'strudel'],
  level: 5,
  samplePack: 'reference/assets/basic-kit',
  sources: {
    strudel: {
      code: `setcps(0.5)
stack(s("bd rim").bank("crate"), s("hh hh hh hh").gain(0.4).mask("1 0 1 0"), n("0 2 4 7").s("sine").slow(2).attack(0.02).release(0.2))`,
      shape: 'script',
    },
    tidal: {
      code: `setcps 0.5\nd1 $ sound "bd rim" # bank "crate"\nd2 $ mask "1 0 1 0" $ sound "hh hh hh hh" # gain 0.4\nd3 $ slow 2 $ note "0 2 4 7" # sound "sine" # attack 0.02 # release 0.2`,
      shape: 'script',
    },
  },
  title: 'mixed integration scene',
} satisfies ParityFixture;
