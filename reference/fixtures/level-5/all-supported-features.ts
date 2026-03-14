import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-5/all-supported-features',
  importTargets: ['tidal', 'strudel'],
  level: 5,
  samplePack: 'reference/assets/basic-kit',
  sources: {
    strudel: {
      code: `stack(
  s("bd bd").fast(2).cut(1).speed(0.5),
  s("sd").begin(0.2).end(0.8).clip(0.5),
  s("sine").attack(0.01).decay(0.08).sustain(0.5).release(0.15).pan(0.7).gain(0.4),
  s("saw").rev().slow(2).lpf(600).hpf(80).gain(0.3)
)`,
      shape: 'script',
    },
    tidal: {
      code: `d1 $ fast 2 $ sound "bd bd" # cut 1 # speed 0.5
d2 $ sound "sd" # begin 0.2 # end 0.8 # clip 0.5
d3 $ sound "sine" # attack 0.01 # decay 0.08 # sustain 0.5 # release 0.15 # pan 0.7 # gain 0.4
d4 $ slow 2 $ rev $ sound "saw" # lpf 600 # hpf 80 # gain 0.3`,
      shape: 'script',
    },
  },
  title: 'all currently supported features mixed',
} satisfies ParityFixture;
