import { type PatternBuilder, defineScene, s } from '@tussel/dsl';

export default defineScene({
  samples: [{ ref: './examples/assets/basic-kit' }],
  transport: { cps: 0.5 },
  master: {},
  channels: {
    main: {
      node: s('bd sd hh cp')
        .jux((x: PatternBuilder) => x.fast(2))
        .room(0.2),
    },
  },
});
