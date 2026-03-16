import { defineScene, note, s } from '@tussel/dsl';

export default defineScene({
  samples: [],
  transport: { cps: 0.75 },
  master: {},
  channels: {
    drums: {
      node: s('bd ~ rim sd').mask('1 1 0 1'),
    },
    hats: {
      node: s('hh hh hh hh').gain(0.5).late(0.01),
    },
    bass: {
      node: note('0 0 3 5').s('saw').slow(2).lpf(700).release(0.3),
    },
    melody: {
      node: note('7 5 3 0').s('triangle').gain(0.15).early(0.125),
    },
  },
});
