import { defineScene, n, s, triangle } from '@tussel/dsl';

export default defineScene({
  metadata: {
    guide: '06-converting-between-formats',
    title: 'Converting Between Formats',
  },
  master: {},
  samples: [{ ref: './examples/assets/basic-kit' }],
  transport: { cps: 0.5 },
  channels: {
    kit: {
      node: s('bd hh sd hh').bank('crate'),
      gain: 0.18,
      mute: false,
      orbit: 'kit',
    },
    arp: {
      node: n('0 2 4 7').s('square').fast(2).pan(triangle.range(-0.6, 0.6).slow(4)),
      gain: 0.07,
      mute: false,
      orbit: 'arp',
    },
  },
});
