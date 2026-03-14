// "Converting Between Formats"
// @guide 06-converting-between-formats
samples('./examples/assets/basic-kit');

scene({
  master: {},
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
