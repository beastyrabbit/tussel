import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-4/adsr-audio',
  importTargets: ['tidal', 'strudel'],
  level: 4,
  sources: {
    strudel: {
      code: `s("sine").attack(0.01).decay(0.1).sustain(0.4).release(0.2)`,
      shape: 'pattern',
    },
    tidal: {
      code: `sound "sine" # attack 0.01 # decay 0.1 # sustain 0.4 # release 0.2`,
      shape: 'pattern',
    },
  },
  title: 'adsr exact wav',
} satisfies ParityFixture;
