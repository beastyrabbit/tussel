// "Samples and Cache"
// @guide 04-samples-and-cache
samples('./examples/assets/basic-kit');
setcps(0.85);

const hats = s('hh hh hh [hh ~]').bank('crate');

scene({
  master: {},
  channels: {
    drums: {
      node: s('bd ~ sd hh').bank('crate'),
      gain: 0.2,
      mute: false,
      orbit: 'drums',
    },
    hats: {
      node: hats.fast(2).mask('<1 1 0 1>/4'),
      gain: 0.12,
      mute: false,
      orbit: 'hats',
    },
    bass: {
      node: n('0 ~ 3 5').s('saw').slow(2).lpf(280),
      gain: 0.08,
      mute: false,
      orbit: 'bass',
    },
  },
});
