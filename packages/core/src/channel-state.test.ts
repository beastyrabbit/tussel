import { defineScene, s } from '@tussel/dsl';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearMixState,
  getChannelRuntimeSnapshot,
  isChannelAudible,
  isHushed,
  resetChannelRuntimeState,
  setChannelMuted,
  setChannelSolo,
  setHush,
  toggleChannelMute,
  toggleChannelSolo,
} from './channel-state.js';
import { queryScene } from './index.js';

function scene() {
  return defineScene({
    channels: {
      d1: { node: s('bd') },
      d2: { node: s('hh') },
    },
    samples: [],
    transport: { cps: 1 },
  });
}

afterEach(() => {
  resetChannelRuntimeState();
});

describe('runtime channel state (mute / solo / hush)', () => {
  it('mute silences only the muted channel', () => {
    const sc = scene();
    expect(queryScene(sc, 0, 1, { cps: 1 }).length).toBe(2);
    setChannelMuted('d1', true);
    const events = queryScene(sc, 0, 1, { cps: 1 });
    expect(events.length).toBe(1);
    expect(events[0]?.channel).toBe('d2');
  });

  it('solo silences every non-soloed channel', () => {
    const sc = scene();
    setChannelSolo('d2', true);
    const events = queryScene(sc, 0, 1, { cps: 1 });
    expect(events.map((event) => event.channel)).toEqual(['d2']);
    // mute still applies on top of solo
    setChannelMuted('d2', true);
    expect(queryScene(sc, 0, 1, { cps: 1 })).toEqual([]);
  });

  it('hush silences everything until cleared', () => {
    const sc = scene();
    setHush(true);
    expect(queryScene(sc, 0, 1, { cps: 1 })).toEqual([]);
    expect(isHushed()).toBe(true);
    // solo cannot override hush
    setChannelSolo('d1', true);
    expect(queryScene(sc, 0, 1, { cps: 1 })).toEqual([]);
    setHush(false);
    expect(queryScene(sc, 0, 1, { cps: 1 }).map((event) => event.channel)).toEqual(['d1']);
  });

  it('toggles and snapshot helpers report state', () => {
    expect(toggleChannelMute('d1')).toBe(true);
    expect(toggleChannelMute('d1')).toBe(false);
    toggleChannelSolo('d2');
    clearMixState();
    expect(getChannelRuntimeSnapshot()).toEqual({ hushed: false, muted: [], soloed: [] });
    expect(isChannelAudible('d1')).toBe(true);
  });

  it('scene-level channel.mute annotates payloads (audio layer filters), runtime state silences queries', () => {
    const sc = defineScene({
      channels: { d1: { node: s('bd'), mute: true }, d2: { node: s('hh') } },
      samples: [],
      transport: { cps: 1 },
    });
    const events = queryScene(sc, 0, 1, { cps: 1 });
    expect(events.map((event) => `${event.channel}:${event.payload.mute === true}`).sort()).toEqual([
      'd1:true',
      'd2:false',
    ]);
  });
});
