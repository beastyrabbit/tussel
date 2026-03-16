import { defineScene, note } from '@tussel/dsl';

export default defineScene({
  samples: [],
  transport: { cps: 0.5 },
  master: {},
  channels: {
    main: {
      node: note('c3 e3 g3 b3').s('saw').fast(2).palindrome().lpf(800).release(0.15),
    },
  },
});
