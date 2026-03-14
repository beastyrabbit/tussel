// "Full Piece Coastline"
// @by eddyflux
// @version 1.0
samples('./examples/assets/basic-kit');
setcps(0.75);

const groove = s('bd [hh hh] sd hh').bank('crate');
const shuffle = s('~ rim ~ [hh rim]').bank('crate').mask('<1 0 1 1>/4');
const bass = n('<0 0 3 5>/2').s('saw').attack(0.01).release(0.2).lpf(sine.range(220, 720).slow(8));
const keys = n('<7 10 12 14>/4').s('triangle').slow(2).pan(sine.range(-0.5, 0.5).slow(8));
const melody = n('<12 10 7 [5 7]>').s('square').fast(2).delay(0.25).room(0.35).mask('<1 1 0 1>/4');

scene({
  master: {},
  channels: {
    drums: {
      node: groove.mask('<1 1 1 1>/4'),
      gain: 0.2,
      mute: false,
      orbit: 'drums',
    },
    percussion: {
      node: shuffle.fast(2),
      gain: 0.12,
      mute: false,
      orbit: 'percussion',
    },
    bass: {
      node: bass,
      gain: 0.1,
      mute: false,
      orbit: 'bass',
    },
    keys: {
      node: keys,
      gain: perlin.range(0.05, 0.12).slow(4),
      mute: false,
      orbit: 'keys',
    },
    melody: {
      node: melody.pan(triangle.range(-0.7, 0.7).slow(6)).late(0.01),
      gain: 0.07,
      mute: false,
      orbit: 'melody',
    },
  },
});
