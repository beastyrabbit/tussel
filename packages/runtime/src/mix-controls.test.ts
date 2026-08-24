import { getChannelRuntimeSnapshot, resetChannelRuntimeState } from '@tussel/core';
import { afterEach, describe, expect, it } from 'vitest';
import { handleMixKeystroke, MIX_HELP_LINE, type MixControlContext, printMixStatus } from './mix-controls.js';

afterEach(() => {
  resetChannelRuntimeState();
});

function context(channels: string[], lines: string[] = []): MixControlContext {
  return { getChannels: () => channels, write: (line) => lines.push(line) };
}

describe('interactive mix controls', () => {
  it('number keys toggle mute on the Nth channel', () => {
    const channels = ['d1', 'd2'];
    handleMixKeystroke('1', context(channels));
    expect(getChannelRuntimeSnapshot().muted).toEqual(['d1']);
    handleMixKeystroke('1', context(channels));
    expect(getChannelRuntimeSnapshot().muted).toEqual([]);
  });

  it('shifted number keys toggle solo', () => {
    const channels = ['d1', 'd2'];
    const action = handleMixKeystroke('@', context(channels));
    expect(action.handled).toBe(true);
    expect(getChannelRuntimeSnapshot().soloed).toEqual(['d2']);
  });

  it('h toggles global hush', () => {
    const ctx = context(['d1']);
    handleMixKeystroke('h', ctx);
    expect(getChannelRuntimeSnapshot().hushed).toBe(true);
    handleMixKeystroke('h', ctx);
    expect(getChannelRuntimeSnapshot().hushed).toBe(false);
  });

  it('c clears the whole mix state', () => {
    handleMixKeystroke('mute:d1:on', context(['d1']));
    handleMixKeystroke('solo:d2:on', context(['d1', 'd2']));
    handleMixKeystroke('c', context(['d1', 'd2']));
    expect(getChannelRuntimeSnapshot()).toEqual({ hushed: false, muted: [], soloed: [] });
  });

  it('scripted mute:/solo: commands set explicit state', () => {
    handleMixKeystroke('mute:d3:on', context(['d3']));
    expect(handleMixKeystroke('mute:d3:off', context(['d3'])).message).toBe('unmuted d3');
    expect(getChannelRuntimeSnapshot().muted).toEqual([]);
  });

  it('unknown keys are not handled', () => {
    expect(handleMixKeystroke('z', context(['d1'])).handled).toBe(false);
  });

  it('status printing renders channel list with flags', () => {
    const lines: string[] = [];
    const ctx = context(['d1', 'd2'], lines);
    handleMixKeystroke('mute:d2:on', ctx);
    printMixStatus(ctx);
    expect(lines.at(-1)).toContain('2:d2 [muted]');
  });

  it('documents its keybindings', () => {
    expect(MIX_HELP_LINE).toContain('mute');
    expect(MIX_HELP_LINE).toContain('solo');
  });
});
