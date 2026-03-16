import { defineScene, note, s, stack } from '@tussel/dsl';

export default defineScene({
  samples: [],
  transport: { cps: 0.5 },
  master: {},
  channels: {
    main: {
      node: stack(s('bd hh sd hh'), note('0 2 4 7').s('triangle').gain(0.3).release(0.2)),
    },
  },
});
