import { createParam, createParams, defineScene, note, s } from '@tussel/dsl';
import { resetParamValues } from '@tussel/ir';
import { afterEach, describe, expect, it } from 'vitest';
import { queryScene } from './index.js';

afterEach(() => {
  resetParamValues();
});

describe('live control parameters', () => {
  it('params resolve to their live value at query time', () => {
    const vol = createParam('vol');
    vol(0.5);
    const scene = defineScene({
      channels: { lead: { node: s('bd').gain(vol) } },
      samples: [],
      transport: { cps: 1 },
    });
    const events = queryScene(scene, 0, 1, { cps: 1 });
    expect(events.map((event) => event.payload.gain)).toEqual([0.5]);

    // Live update — no scene reload needed.
    vol.set(1);
    expect(queryScene(scene, 0, 1, { cps: 1 }).map((event) => event.payload.gain)).toEqual([1]);
  });

  it('unset params fall back to 0 and work as pitch sources', () => {
    const { step } = createParams('step');
    const scene = defineScene({
      channels: { lead: { node: note(step.range(0, 12)) } },
      samples: [],
      transport: { cps: 1 },
    });
    expect(queryScene(scene, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([0]);
    step.set(0.5); // signals are 0..1: range(0,12) maps 0.5 -> 6
    expect(queryScene(scene, 0, 1, { cps: 1 }).map((event) => event.payload.note)).toEqual([6]);
  });

  it('params compose with signals', () => {
    const depth = createParam('depth');
    depth(2);
    const scene = defineScene({
      channels: { lead: { node: s('bd').speed(depth.mul(2)) } },
      samples: [],
      transport: { cps: 1 },
    });
    expect(queryScene(scene, 0, 1, { cps: 1 }).map((event) => event.payload.speed)).toEqual([4]);
  });
});
