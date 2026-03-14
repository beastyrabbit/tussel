import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { events: 'exact' },
  cps: 0.5,
  durationCycles: 4,
  id: 'level-5/euclidean-polyrhythm',
  importTargets: ['strudel'],
  level: 5,
  sources: {
    strudel: {
      code: `setcps(0.5)
stack(s("bd(3,8)").gain(0.9), s("hh(5,8)").gain(0.4), s("cp(2,5)").gain(0.6).pan(-0.5))`,
      shape: 'script',
    },
  },
  title: 'euclidean rhythms in polyrhythmic stack',
} satisfies ParityFixture;
