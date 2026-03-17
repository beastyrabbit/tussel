import { defineScene, note } from '@tussel/dsl';

export default defineScene({
  samples: [],
  transport: { cps: 0.5 },
  master: {},
  channels: {
    main: {
      node: note('0').s('sine').release(0.3),
    },
  },
});
