// "Patterns and Mini"
// @guide 02-patterns-and-mini
setcps(1);

const lead = mini`60 [62 64] <67 69>`;
const pulse = m`noise ~ [noise noise] ~`;

scene({
  master: {},
  channels: {
    texture: {
      node: s(pulse).hpf(4500),
      gain: 0.025,
      mute: false,
      orbit: 'texture',
    },
    lead: {
      node: n(lead).s('square').fast(2).mask('<1 1 0 1>/4'),
      gain: 0.09,
      mute: false,
      orbit: 'lead',
    },
    bass: {
      node: n('<60 63 65 67>/2').s('saw').slow(2).lpf(sine.range(300, 1400).slow(4)),
      gain: 0.08,
      mute: false,
      orbit: 'bass',
    },
  },
});
