import { type PatternBuilder, defineScene, note, s } from '@tussel/dsl';

export default defineScene({
  samples: [{ ref: './examples/assets/basic-kit' }],
  transport: { cps: 0.5 },
  master: {},
  channels: {
    drums: {
      node: s('bd sd hh cp').every(3, (x: PatternBuilder) => x.fast(2)),
    },
    melody: {
      node: note('0 2 4 7')
        .s('sine')
        .release(0.2)
        .gain(0.3)
        .every(4, (x: PatternBuilder) => x.slow(2)),
    },
  },
});
