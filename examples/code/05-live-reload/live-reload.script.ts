// "Live Reload"
// @guide 05-live-reload
setcps(0.7);

const pulse = n('0 2 4 7').s('sine').attack(0.02).release(0.2);
const counter = n('<7 5 4 2>').s('triangle').slow(2).pan(sine.range(-0.8, 0.8).slow(8));

scene({
  master: {},
  channels: {
    pulse: {
      node: pulse.late(0.01),
      gain: 0.1,
      mute: false,
      orbit: 'pulse',
    },
    counter: {
      node: counter.late(0.01),
      gain: 0.07,
      mute: false,
      orbit: 'counter',
    },
    air: {
      node: s('noise ~ noise [~ noise]').hpf(5000).fast(2).late(0.01),
      gain: 0.03,
      mute: false,
      orbit: 'air',
    },
  },
});
