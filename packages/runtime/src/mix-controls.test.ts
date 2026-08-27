import { getChannelRuntimeSnapshot, resetChannelRuntimeState } from '@tussel/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  attachMixControls,
  handleMixKeystroke,
  MIX_HELP_LINE,
  type MixControlContext,
  printMixStatus,
} from './mix-controls.js';

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
    handleMixKeystroke('h', context(['d1', 'd2']));
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

  it('keeps its keypress listener active until detach and restores raw mode', async () => {
    const stream = new FakeKeypressStream();
    const lines: string[] = [];
    const detach = attachMixControls(
      stream,
      () => ['d1'],
      (line) => lines.push(line),
      {
        emitKeypressEvents: () => {},
        onInterrupt: () => {},
      },
    );
    await Promise.resolve();

    expect(stream.isRaw).toBe(true);
    stream.emitKeypress('1', { ctrl: false, name: '1' });
    expect(getChannelRuntimeSnapshot().muted).toEqual(['d1']);

    detach();
    expect(stream.isRaw).toBe(false);
    expect(stream.pauseCalls).toBe(1);
    expect(stream.listenerCount).toBe(0);
    stream.emitKeypress('1', { ctrl: false, name: '1' });
    expect(getChannelRuntimeSnapshot().muted).toEqual(['d1']);
  });

  it('does not enable raw mode if detached during asynchronous setup', async () => {
    const stream = new FakeKeypressStream();
    let finishSetup: (() => void) | undefined;
    const setup = new Promise<void>((resolve) => {
      finishSetup = resolve;
    });
    const detach = attachMixControls(
      stream,
      () => ['d1'],
      () => {},
      {
        emitKeypressEvents: () => setup,
      },
    );

    detach();
    finishSetup?.();
    await setup;
    await Promise.resolve();

    expect(stream.rawModeCalls).not.toContain(true);
    expect(stream.resumeCalls).toBe(0);
    expect(stream.pauseCalls).toBe(0);
    expect(stream.listenerCount).toBe(0);
  });

  it('does not pause a stream that was already flowing before attach', async () => {
    const stream = new FakeKeypressStream();
    stream.readableFlowing = true;
    const detach = attachMixControls(
      stream,
      () => ['d1'],
      () => {},
      {
        emitKeypressEvents: () => {},
      },
    );
    await Promise.resolve();

    detach();

    expect(stream.resumeCalls).toBe(0);
    expect(stream.pauseCalls).toBe(0);
    expect(stream.readableFlowing).toBe(true);
  });

  it('detaches and reports asynchronous setup failures', async () => {
    const stream = new FakeKeypressStream();
    const lines: string[] = [];
    attachMixControls(
      stream,
      () => ['d1'],
      (line) => lines.push(line),
      {
        emitKeypressEvents: () => Promise.reject(new Error('readline failed')),
      },
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(stream.listenerCount).toBe(0);
    expect(stream.rawModeCalls).not.toContain(true);
    expect(lines.at(-1)).toBe('mix controls unavailable: readline failed');
  });

  it('forwards Ctrl+C through the interrupt callback', async () => {
    const stream = new FakeKeypressStream();
    let interrupts = 0;
    const detach = attachMixControls(
      stream,
      () => ['d1'],
      () => {},
      {
        emitKeypressEvents: () => {},
        onInterrupt: () => {
          interrupts += 1;
        },
      },
    );
    await Promise.resolve();

    stream.emitKeypress('\u0003', { ctrl: true, name: 'c' });
    expect(interrupts).toBe(1);
    detach();
  });
});

type KeypressListener = (chunk: string, key: { name: string; ctrl: boolean }) => void;

class FakeKeypressStream {
  isRaw = false;
  isTTY = true;
  readableFlowing: boolean | null = false;
  pauseCalls = 0;
  rawModeCalls: boolean[] = [];
  resumeCalls = 0;
  private listeners = new Set<KeypressListener>();

  get listenerCount(): number {
    return this.listeners.size;
  }

  emitKeypress(chunk: string, key: { name: string; ctrl: boolean }): void {
    for (const listener of this.listeners) {
      listener(chunk, key);
    }
  }

  off(_event: 'keypress', listener: KeypressListener): void {
    this.listeners.delete(listener);
  }

  on(_event: 'keypress', listener: KeypressListener): void {
    this.listeners.add(listener);
  }

  pause(): void {
    this.pauseCalls += 1;
    this.readableFlowing = false;
  }

  resume(): void {
    this.resumeCalls += 1;
    this.readableFlowing = true;
  }

  setRawMode(enabled: boolean): void {
    this.isRaw = enabled;
    this.rawModeCalls.push(enabled);
  }
}
