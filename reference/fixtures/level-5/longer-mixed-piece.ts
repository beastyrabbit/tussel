import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 0.5,
  durationCycles: 2,
  id: 'level-5/longer-mixed-piece',
  importTargets: ['tidal', 'strudel'],
  level: 5,
  samplePack: 'reference/assets/basic-kit',
  sources: {
    strudel: {
      code: `setcps(0.5)
stack(
  s("bd [hh hh]").fast(2).gain(0.8),
  s("sine").slow(2).pan(0.25).lpf(900)
)`,
      shape: 'script',
    },
    tidal: {
      code: `setcps 0.5
d1 $ fast 2 $ sound "bd [hh hh]" # gain 0.8
d2 $ slow 2 $ sound "sine" # pan 0.25 # lpf 900`,
      shape: 'script',
    },
  },
  title: 'longer mixed integration piece',
} satisfies ParityFixture;
