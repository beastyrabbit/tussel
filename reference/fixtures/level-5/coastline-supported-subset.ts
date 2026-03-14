import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 0.75,
  durationCycles: 2,
  id: 'level-5/coastline-supported-subset',
  importTargets: ['tidal', 'strudel'],
  level: 5,
  samplePack: 'reference/assets/basic-kit',
  sources: {
    strudel: {
      code: `setcps(0.75)
stack(
  s("bd [hh hh] sd hh").gain(0.9),
  s("saw").slow(2).pan(0.2).lpf(700),
  s("triangle").fast(2).gain(0.35).hpf(120)
)`,
      shape: 'script',
    },
    tidal: {
      code: `setcps 0.75
d1 $ sound "bd [hh hh] sd hh" # gain 0.9
d2 $ slow 2 $ sound "saw" # pan 0.2 # lpf 700
d3 $ fast 2 $ sound "triangle" # gain 0.35 # hpf 120`,
      shape: 'script',
    },
  },
  title: 'coastline style supported subset',
} satisfies ParityFixture;
