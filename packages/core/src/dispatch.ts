import { Note } from '@tonaljs/tonal';
import { coerceFiniteNumber, namedPitchToFrequency } from '@tussel/ir';
import { DEFAULT_MIDI_VALUE } from './constants.js';
import type { ExternalDispatchEvent, PlaybackEvent } from './types.js';

export function collectExternalDispatches(
  event: PlaybackEvent,
  targetTime?: number,
): ExternalDispatchEvent[] {
  if (event.payload.mute) {
    return [];
  }

  const dispatches: ExternalDispatchEvent[] = [];
  const midiPort = resolveDispatchString(event.payload.midiport, 'default');
  const channelNumber = clampDispatchInteger(event.payload.midichan, 1, 16, 1);
  const midiCc = coerceFiniteNumber(event.payload.midicc ?? event.payload.ccn);
  const midiCommand = event.payload.midicmd;
  const midiBend = coerceFiniteNumber(event.payload.midibend);
  const midiTouch = coerceFiniteNumber(event.payload.miditouch);

  if (midiCc !== undefined) {
    dispatches.push({
      begin: event.begin,
      channel: event.channel,
      channelNumber,
      control: clampDispatchInteger(midiCc, 0, 127, 0),
      end: event.end,
      kind: 'midi-cc',
      payload: { ...event.payload },
      port: midiPort,
      targetTime,
      value: clampDispatchInteger(resolveMidiCcValue(event.payload), 0, 127, 0),
    });
  }

  if (midiCommand !== undefined) {
    dispatches.push({
      begin: event.begin,
      channel: event.channel,
      command:
        typeof midiCommand === 'number' ? Math.round(midiCommand) : `${midiCommand}`.trim().toLowerCase(),
      end: event.end,
      kind: 'midi-command',
      payload: { ...event.payload },
      port: midiPort,
      targetTime,
    });
  }

  if (midiBend !== undefined) {
    dispatches.push({
      begin: event.begin,
      channel: event.channel,
      channelNumber,
      end: event.end,
      kind: 'midi-pitch-bend',
      payload: { ...event.payload },
      port: midiPort,
      targetTime,
      value: clampDispatchInteger(midiBend, 0, 16_383, 8_192),
    });
  }

  if (midiTouch !== undefined) {
    dispatches.push({
      begin: event.begin,
      channel: event.channel,
      channelNumber,
      end: event.end,
      kind: 'midi-touch',
      payload: { ...event.payload },
      port: midiPort,
      targetTime,
      value: clampDispatchInteger(midiTouch, 0, 127, 0),
    });
  }

  const midiNote = resolveMidiDispatchNote(event.payload);
  if (midiNote !== undefined && (midiPort !== 'default' || event.payload.midichan !== undefined)) {
    dispatches.push({
      begin: event.begin,
      channel: event.channel,
      channelNumber,
      end: event.end,
      kind: 'midi-note',
      note: clampDispatchInteger(midiNote, 0, 127, 60),
      payload: { ...event.payload },
      port: midiPort,
      targetTime,
      velocity: clampDispatchInteger(resolveMidiVelocity(event.payload), 1, 127, 100),
    });
  }

  const oscPath = resolveOscDispatchPath(event);
  if (oscPath) {
    dispatches.push({
      begin: event.begin,
      channel: event.channel,
      end: event.end,
      host: resolveDispatchString(event.payload.oschost, '127.0.0.1'),
      kind: 'osc',
      path: oscPath,
      payload: { ...event.payload },
      port: clampDispatchInteger(event.payload.oscport, 1, 65_535, 57_120),
      targetTime,
    });
  }

  return dispatches;
}

function resolveDispatchString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function clampDispatchInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = coerceFiniteNumber(value);
  if (numeric === undefined) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function resolveMidiCcValue(payload: Record<string, unknown>): number {
  return (
    coerceFiniteNumber(payload.ccv) ??
    coerceFiniteNumber(payload.midivalue) ??
    coerceFiniteNumber(payload.value) ??
    normalizeMidiScalar(coerceFiniteNumber(payload.velocity)) ??
    normalizeMidiScalar(coerceFiniteNumber(payload.gain)) ??
    DEFAULT_MIDI_VALUE
  );
}

function resolveMidiVelocity(payload: Record<string, unknown>): number {
  return (
    normalizeMidiScalar(coerceFiniteNumber(payload.velocity) ?? coerceFiniteNumber(payload.gain)) ??
    DEFAULT_MIDI_VALUE
  );
}

function normalizeMidiScalar(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value >= 0 && value <= 1 ? value * 127 : value;
}

function resolveMidiDispatchNote(payload: Record<string, unknown>): number | undefined {
  const frequency = coerceFiniteNumber(payload.freq);
  if (frequency !== undefined && frequency > 0) {
    return 69 + 12 * Math.log2(frequency / 440);
  }

  const numericNote = coerceFiniteNumber(payload.note ?? payload.n);
  if (numericNote !== undefined) {
    return numericNote;
  }

  const noteName = payload.note ?? payload.n;
  if (typeof noteName === 'string' && noteName.trim() !== '') {
    const trimmed = noteName.trim();
    const midi = Note.midi(trimmed);
    if (midi !== null) {
      return midi;
    }
    const namedFrequency = namedPitchToFrequency(trimmed);
    if (namedFrequency !== undefined) {
      return 69 + 12 * Math.log2(namedFrequency / 440);
    }
  }

  return undefined;
}

function resolveOscDispatchPath(event: PlaybackEvent): string | undefined {
  const osc = event.payload.osc;
  if (typeof osc === 'string' && osc.trim() !== '') {
    return osc.startsWith('/') ? osc : `/${osc}`;
  }
  if (event.payload.oschost !== undefined || event.payload.oscport !== undefined) {
    return `/${event.channel}`;
  }
  return undefined;
}
