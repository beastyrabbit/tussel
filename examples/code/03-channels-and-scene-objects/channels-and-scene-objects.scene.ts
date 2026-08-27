import { defineScene, n, s, sine } from '@tussel/dsl';

const pulse = n('60 62 64 67').s('triangle').fast(2);

export default defineScene({
  metadata: {
    guide: '03-channels-and-scene-objects',
    title: 'Channels and Scene Objects',
  },
  master: {},
  samples: [],
  transport: { cps: 0.6 },
  channels: {
    drums: {
      node: s('noise ~ noise noise').hpf(6000),
      gain: 0.03,
      mute: false,
      orbit: 'drums',
    },
    bass: {
      node: n('60 ~ 63 ~').s('saw').slow(2).lpf(220),
      gain: 0.14,
      mute: false,
      orbit: 'bass',
    },
    lead: {
      node: pulse.pan(sine.range(-0.4, 0.4).slow(4)),
      gain: 0.09,
      mute: false,
      orbit: 'lead',
    },
  },
});
