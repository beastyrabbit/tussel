import { defineScene, n, s, sine } from '@tussel/dsl';

const pulse = n('0 2 4 7').s('sine').attack(0.02).release(0.2);
const counter = n('<7 5 4 2>').s('triangle').slow(2).pan(sine.range(-0.8, 0.8).slow(8));

export default defineScene({
  metadata: {
    guide: '05-live-reload',
    title: 'Live Reload',
  },
  master: {},
  samples: [],
  transport: { cps: 0.7 },
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
