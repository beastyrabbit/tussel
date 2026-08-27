import { defineScene, note, s } from '@tussel/dsl';

export default defineScene({
  samples: [{ ref: './examples/assets/basic-kit' }],
  transport: { cps: 0.75 },
  master: {},
  channels: {
    drums: {
      node: s('bd ~ rim sd').mask('1 1 0 1'),
    },
    hats: {
      node: s('hh hh hh hh').gain(0.5),
    },
    bass: {
      node: note('60 60 63 65').s('saw').slow(2).lpf(700).release(0.3),
    },
    melody: {
      node: note('67 65 63 60').s('triangle').gain(0.15),
    },
  },
});
