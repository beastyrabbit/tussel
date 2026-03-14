import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 0.5,
  durationCycles: 4,
  id: 'level-5/scale-transpose',
  importTargets: ['strudel'],
  level: 5,
  sources: {
    strudel: {
      code: `setcps(0.5)
n("0 1 2 3 4 5 6 7").scale("C:minor").s("sine").scaleTranspose("<0 2 4>").release(0.1)`,
      shape: 'script',
    },
  },
  title: 'scale and scaleTranspose over slowcat progression',
} satisfies ParityFixture;
