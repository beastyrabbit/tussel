import { defineScene, s, stack } from '@tussel/dsl';

export default defineScene({
  samples: [],
  transport: { cps: 0.5 },
  master: {},
  channels: {
    main: {
      node: stack(s('bd(3,8)').gain(0.9), s('hh(5,8)').gain(0.4), s('cp(2,5)').gain(0.6).pan(-0.5)),
    },
  },
});
