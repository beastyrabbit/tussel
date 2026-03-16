import { defineScene, s } from '@tussel/dsl';

export default defineScene({
  samples: [],
  transport: { cps: 0.5 },
  master: {},
  channels: {
    main: {
      node: s('bd sd hh cp')
        .off(0.125, (x) => x.gain(0.3))
        .jux((x) => x.fast(2)),
    },
  },
});
