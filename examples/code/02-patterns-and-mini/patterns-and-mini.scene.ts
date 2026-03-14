import { defineScene, m, mini, n, s, sine } from '@tussel/dsl';

const lead = mini`0 [2 4] <7 9>`;
const pulse = m`noise ~ [noise noise] ~`;

export default defineScene({
  metadata: {
    guide: '02-patterns-and-mini',
    title: 'Patterns and Mini',
  },
  master: {},
  samples: [],
  transport: { cps: 1 },
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
      node: n('<0 3 5 7>/2').s('saw').slow(2).lpf(sine.range(300, 1400).slow(4)),
      gain: 0.08,
      mute: false,
      orbit: 'bass',
    },
  },
});
