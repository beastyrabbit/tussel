import { defineScene, note, s, stack } from '@tussel/dsl';

export default defineScene({
  samples: [{ ref: './examples/assets/basic-kit' }],
  transport: { cps: 0.5 },
  master: {},
  channels: {
    main: {
      node: stack(s('bd hh sd hh'), note('60 62 64 67').s('triangle').gain(0.3).release(0.2)),
    },
  },
});
