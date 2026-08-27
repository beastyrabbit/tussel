/**
 * Runtime channel state: mute / solo / hush.
 *
 * Unlike `ChannelSpec.mute` (baked into the scene file), this state lives at
 * runtime and survives hot reloads — a livecoder can mute `d3` without
 * touching the scene. Query-time integration: channels that are not audible
 * produce no events.
 *
 * Semantics mirror Tidal/DAW conventions:
 * - `mute`: the channel is silenced.
 * - `solo`: when ANY channel is soloed, only soloed channels are audible
 *   (mute flags still apply on top).
 * - `hush`: global kill switch — nothing is audible until un-hushed.
 */

import { createLogger } from '@tussel/ir';

const CHANNEL_STATE_KEY = Symbol.for('tussel.channelRuntimeState');

const channelStateLogger = createLogger('tussel/core');

export interface ChannelRuntimeSnapshot {
  hushed: boolean;
  muted: string[];
  soloed: string[];
}

interface ChannelRuntimeState {
  hushed: boolean;
  muted: Set<string>;
  soloed: Set<string>;
}

function channelRuntimeState(): ChannelRuntimeState {
  const root = globalThis as typeof globalThis & { [CHANNEL_STATE_KEY]?: ChannelRuntimeState };
  const current = root[CHANNEL_STATE_KEY];
  if (current) {
    return current;
  }
  const created = {
    hushed: false,
    muted: new Set<string>(),
    soloed: new Set<string>(),
  };
  root[CHANNEL_STATE_KEY] = created;
  return created;
}

/** Whether the channel currently produces audio, given mute/solo/hush state. */
export function isChannelAudible(channel: string): boolean {
  const state = channelRuntimeState();
  if (state.hushed) {
    return false;
  }
  if (state.muted.has(channel)) {
    return false;
  }
  if (state.soloed.size > 0 && !state.soloed.has(channel)) {
    return false;
  }
  return true;
}

export function setChannelMuted(channel: string, muted: boolean): void {
  const state = channelRuntimeState();
  if (muted) {
    state.muted.add(channel);
    channelStateLogger.info(`channel ${channel} muted`, {
      code: 'TUSSEL_CHANNEL_MUTE',
      details: { channel },
    });
  } else {
    state.muted.delete(channel);
  }
}

export function toggleChannelMute(channel: string): boolean {
  const state = channelRuntimeState();
  const muted = !state.muted.has(channel);
  setChannelMuted(channel, muted);
  return muted;
}

export function setChannelSolo(channel: string, solo: boolean): void {
  const state = channelRuntimeState();
  if (solo) {
    state.soloed.add(channel);
  } else {
    state.soloed.delete(channel);
  }
}

/** Toggle solo; soloing one channel does not unsolo others (stacked solos allowed). */
export function toggleChannelSolo(channel: string): boolean {
  const state = channelRuntimeState();
  const solo = !state.soloed.has(channel);
  setChannelSolo(channel, solo);
  return solo;
}

/** Global kill switch — silence every channel until {@link setHush}(false). */
export function setHush(hushed: boolean): void {
  channelRuntimeState().hushed = hushed;
}

export function isHushed(): boolean {
  return channelRuntimeState().hushed;
}

/** Clear hush plus every mute and solo flag. */
export function clearMixState(): void {
  const state = channelRuntimeState();
  state.hushed = false;
  state.muted.clear();
  state.soloed.clear();
}

export function getChannelRuntimeSnapshot(): ChannelRuntimeSnapshot {
  const state = channelRuntimeState();
  return {
    hushed: state.hushed,
    muted: [...state.muted].sort(),
    soloed: [...state.soloed].sort(),
  };
}

/** Reset all runtime mix state (tests and scene reloads). */
export function resetChannelRuntimeState(): void {
  const state = channelRuntimeState();
  state.hushed = false;
  state.muted.clear();
  state.soloed.clear();
}
