import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'tolerance' },
  cps: 0.5,
  durationCycles: 4,
  id: 'level-5/euclidean-layers',
  importTargets: ['strudel'],
  level: 5,
  sources: {
    strudel: {
      code: `stack(
  note("c2").s("sawtooth").euclidRot(3, 8, 0).gain(0.4).lpf(400),
  note("e4 g4 b4").s("sine").fast(2).gain(0.3),
  note("c5").s("square").euclidRot(5, 8, 2).gain(0.2).hpf(2000)
)`,
      shape: 'script',
    },
  },
  title: 'layered euclidean patterns with different timbres',
} satisfies ParityFixture;
