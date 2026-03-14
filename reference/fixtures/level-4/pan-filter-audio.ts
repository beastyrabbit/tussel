import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-4/pan-filter-audio',
  importTargets: ['tidal', 'strudel'],
  level: 4,
  sources: {
    strudel: {
      code: `s("saw").pan(0.25).lpf(800).hpf(100)`,
      shape: 'pattern',
    },
    tidal: {
      code: `sound "saw" # pan 0.25 # lpf 800 # hpf 100`,
      shape: 'pattern',
    },
  },
  title: 'pan and filter exact wav',
} satisfies ParityFixture;
