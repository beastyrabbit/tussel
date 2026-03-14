import type { ParityFixture } from '../../../packages/parity/src/schema.js';

export default {
  compare: { audio: 'exact-pcm16', events: 'exact' },
  cps: 1,
  durationCycles: 1,
  id: 'level-3/two-layer-sample-audio',
  importTargets: ['tidal', 'strudel'],
  level: 3,
  samplePack: 'reference/assets/basic-kit',
  sources: {
    strudel: {
      code: `s("[bd, hh]")`,
      shape: 'pattern',
    },
    tidal: {
      code: `sound "[bd, hh]"`,
      shape: 'pattern',
    },
  },
  title: 'two layer sample exact wav',
} satisfies ParityFixture;
