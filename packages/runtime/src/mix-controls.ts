/**
 * Interactive mix controls for the livecoding daemon.
 *
 * When running with hot reload on a TTY, number keys mute/unmute scene
 * channels, shifted number keys solo them, `h` toggles global hush and `c`
 * clears the mix state — all taking effect on the next query cycle without
 * reloading the scene.
 */

import {
  clearMixState,
  getChannelRuntimeSnapshot,
  setChannelMuted,
  setChannelSolo,
  setHush,
  toggleChannelMute,
  toggleChannelSolo,
} from '@tussel/core';

const DIGIT_SOLO_KEYS = ['!', '@', '#', '$', '%', '^', '&', '*', '('];

export interface MixControlContext {
  /** Scene channel names in display order (index 0 -> key "1"). */
  getChannels: () => string[];
  /** Rendered status output goes here (terminal or test capture). */
  write: (line: string) => void;
}

export interface MixActionResult {
  handled: boolean;
  message?: string;
}

function formatStatus(channels: string[]): string {
  if (channels.length === 0) {
    return 'no channels';
  }
  const snapshot = getChannelRuntimeSnapshot();
  const parts = channels.map((name, index) => {
    const flags =
      `${snapshot.muted.includes(name) ? ' [muted]' : ''}${snapshot.soloed.includes(name) ? ' [solo]' : ''}` ||
      '';
    return `${index + 1}:${name}${flags}`;
  });
  return snapshot.hushed ? `HUSHED — ${parts.join('  ')}` : parts.join('  ');
}

/**
 * Apply a single keystroke to the mix state.
 * Keys: 1-9 mute toggle, !@#$%^&*( solo toggle, h hush, c clear, l/?
 * re-print status.
 */
export function handleMixKeystroke(key: string, context: MixControlContext): MixActionResult {
  const channels = context.getChannels();
  const digit = /^[1-9]$/.exec(key);
  if (digit) {
    const index = Number(key) - 1;
    const channel = channels[index];
    if (!channel) {
      return { handled: true, message: `no channel ${key}` };
    }
    const muted = toggleChannelMute(channel);
    return { handled: true, message: `${muted ? 'muted' : 'unmuted'} ${channel}` };
  }

  const soloIndex = DIGIT_SOLO_KEYS.indexOf(key);
  if (soloIndex !== -1) {
    const channel = channels[soloIndex];
    if (!channel) {
      return { handled: true, message: `no channel ${soloIndex + 1}` };
    }
    const solo = toggleChannelSolo(channel);
    return { handled: true, message: `${solo ? 'soloed' : 'unsoloed'} ${channel}` };
  }

  if (key === 'h') {
    const hushed = !getChannelRuntimeSnapshot().hushed;
    setHush(hushed);
    return { handled: true, message: hushed ? 'hush ON' : 'hush OFF' };
  }

  if (key === 'c') {
    clearMixState();
    return { handled: true, message: 'mix state cleared' };
  }

  if (key === 'l' || key === '?') {
    return { handled: true, message: formatStatus(channels) };
  }

  // Explicit mute/solo setters are useful for tests and scripted control.
  const setMute = /^mute:(.+):(on|off)$/.exec(key);
  if (setMute?.[1]) {
    setChannelMuted(setMute[1], setMute[2] === 'on');
    return { handled: true, message: `${setMute[2] === 'on' ? 'muted' : 'unmuted'} ${setMute[1]}` };
  }
  const setSolo = /^solo:(.+):(on|off)$/.exec(key);
  if (setSolo?.[1]) {
    setChannelSolo(setSolo[1], setSolo[2] === 'on');
    return { handled: true, message: `${setSolo[2] === 'on' ? 'soloed' : 'unsoloed'} ${setSolo[1]}` };
  }

  return { handled: false };
}

export const MIX_HELP_LINE = 'mix keys: 1-9 mute | shift+1-9 solo | h hush | c clear | l status';

/** Print the current mix status line. */
export function printMixStatus(context: MixControlContext): void {
  context.write(formatStatus(context.getChannels()));
}

interface KeypressLikeEmitter {
  isRaw?: boolean;
  isTTY?: boolean;
  readableFlowing?: boolean | null;
  setRawMode?(enabled: boolean): unknown;
  on(event: 'keypress', listener: (chunk: string, key: { name: string; ctrl: boolean }) => void): unknown;
  off?(event: 'keypress', listener: (chunk: string, key: { name: string; ctrl: boolean }) => void): unknown;
  removeListener?(
    event: 'keypress',
    listener: (chunk: string, key: { name: string; ctrl: boolean }) => void,
  ): unknown;
  pause?: () => void;
  resume?: () => void;
}

export interface MixControlOptions {
  emitKeypressEvents?: (stream: KeypressLikeEmitter) => Promise<void> | void;
  onInterrupt?: () => void;
}

/**
 * Attach interactive mix controls to a TTY stream. Returns a detach function.
 * No-op when the stream is not a TTY (CI, piped output).
 */
export function attachMixControls(
  stdin: KeypressLikeEmitter,
  getChannels: () => string[],
  write: (line: string) => void,
  options: MixControlOptions = {},
): () => void {
  if (!stdin.isTTY) {
    return () => {};
  }

  let detached = false;
  let rawModeChanged = false;
  let resumedByControls = false;
  const previousRawMode = stdin.isRaw ?? false;
  const wasFlowing = stdin.readableFlowing === true;
  const emitKeypressEvents =
    options.emitKeypressEvents ??
    (async (stream: KeypressLikeEmitter): Promise<void> => {
      const readline = await import('node:readline');
      readline.emitKeypressEvents(stream as NodeJS.ReadableStream);
    });
  const initializeKeypress = async (): Promise<void> => {
    await emitKeypressEvents(stdin);
    if (detached) {
      return;
    }
    stdin.setRawMode?.(true);
    rawModeChanged = stdin.setRawMode !== undefined;
    if (!wasFlowing && stdin.resume) {
      stdin.resume();
      resumedByControls = true;
    }
  };

  const context: MixControlContext = { getChannels, write };
  const listener = (_chunk: string, key: { name: string; ctrl: boolean }): void => {
    if (detached) {
      return;
    }
    const name = key?.name ?? '';
    if (key?.ctrl && name === 'c') {
      (options.onInterrupt ?? (() => process.kill(process.pid, 'SIGINT')))();
      return;
    }
    const result = handleMixKeystroke(name === 'return' ? '\n' : (_chunk ?? '').trim() || name, context);
    if (result.handled && result.message !== undefined) {
      write(result.message);
      printMixStatus(context);
    }
  };

  stdin.on('keypress', listener);
  write(MIX_HELP_LINE);
  printMixStatus(context);

  const detach = (): void => {
    if (detached) {
      return;
    }
    detached = true;
    if (stdin.off) {
      stdin.off('keypress', listener);
    } else {
      stdin.removeListener?.('keypress', listener);
    }
    if (rawModeChanged) {
      stdin.setRawMode?.(previousRawMode);
    }
    if (resumedByControls) {
      stdin.pause?.();
    }
  };

  void initializeKeypress().catch((error: unknown) => {
    if (detached) {
      return;
    }
    detach();
    write(`mix controls unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });

  return detach;
}
