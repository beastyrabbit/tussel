import { defineScene, note, s } from '@tussel/dsl';

export default defineScene({
  samples: [{ ref: './examples/assets/basic-kit' }],
  transport: { cps: 0.5 },
  master: {},
  channels: {
    drums: {
      node: s('bd sd:1 bd sd:2').room(0.3).delay(0.25),
    },
    bass: {
      node: note('0 3 5 7').s('saw').lpf(600).release(0.2),
      gain: 0.3,
    },
    hats: {
      node: s('hh hh hh hh').gain(0.25).pan(0.5).delay(0.15),
    },
  },
});
