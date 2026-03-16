import { defineScene, s, stack } from '@tussel/dsl';

export default defineScene({
  samples: [],
  transport: { cps: 0.5 },
  master: {},
  channels: {
    main: {
      node: stack(s('bd bd').fast(2).cut(1), s('hh hh hh hh').gain(0.4), s('sd').slow(2).speed(0.5)),
    },
  },
});
