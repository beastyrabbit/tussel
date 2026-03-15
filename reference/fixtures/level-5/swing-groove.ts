import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'tolerance' },
  cps: 0.5,
  durationCycles: 4,
  id: 'level-5/swing-groove',
  importTargets: ['strudel'],
  level: 5,
  sources: {
    strudel: {
      code: `note("c3 e3 g3 c4 e4 g4 c3 e3")
  .s("square")
  .swing(4)
  .gain(0.5)
  .lpf(1500)
  .delay(0.3)
  .room(0.15)`,
      shape: 'script',
    },
  },
  title: 'swing groove with delay and reverb',
} satisfies ParityFixture;
