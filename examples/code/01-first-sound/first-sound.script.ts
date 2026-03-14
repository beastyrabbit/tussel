// "First Sound"
// @guide 01-first-sound
setcps(0.75);

scene({
  master: {},
  channels: {
    pulse: {
      node: n('0 2 4 7').s('sine').attack(0.02).release(0.25).slow(2),
      gain: 0.12,
      mute: false,
      orbit: 'pulse',
    },
    answer: {
      node: n('<7 4 2 0>').s('triangle').fast(2).pan(sine.range(-0.6, 0.6).slow(4)),
      gain: 0.08,
      mute: false,
      orbit: 'answer',
    },
    air: {
      node: s('noise ~ noise [~ noise]').hpf(5000).fast(2),
      gain: 0.03,
      mute: false,
      orbit: 'air',
    },
  },
});
