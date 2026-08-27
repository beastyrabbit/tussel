import {
  getHeldMidiNotes,
  getInputValue,
  resetInputRegistry,
  resetMidiNoteState,
  resolveMidiInputKey,
} from '@tussel/ir';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMidiInputMessage, describeMidiMessage } from './midi-input.js';

afterEach(() => {
  resetInputRegistry();
  resetMidiNoteState();
});

describe('describeMidiMessage', () => {
  it('parses note on', () => {
    const result = describeMidiMessage([0x90, 60, 100]);
    expect(result).toEqual({ channel: 1, data1: 60, data2: 100, type: 'noteOn' });
  });

  it('parses note on with velocity 0 as note off', () => {
    const result = describeMidiMessage([0x90, 60, 0]);
    expect(result).toEqual({ channel: 1, data1: 60, data2: 0, type: 'noteOff' });
  });

  it('parses note off', () => {
    const result = describeMidiMessage([0x80, 60, 64]);
    expect(result).toEqual({ channel: 1, data1: 60, data2: 64, type: 'noteOff' });
  });

  it('parses CC', () => {
    const result = describeMidiMessage([0xb0, 1, 127]);
    expect(result).toEqual({ channel: 1, data1: 1, data2: 127, type: 'cc' });
  });

  it('parses pitch bend', () => {
    const result = describeMidiMessage([0xe0, 0, 64]);
    expect(result).toEqual({ channel: 1, data1: 0, data2: 64, type: 'pitchBend' });
  });

  it('parses channel pressure', () => {
    const result = describeMidiMessage([0xd0, 100, 0]);
    expect(result).toEqual({ channel: 1, data1: 100, data2: 0, type: 'channelPressure' });
  });

  it('parses channel 10 (0-indexed 9)', () => {
    const result = describeMidiMessage([0x99, 36, 100]);
    expect(result).toEqual({ channel: 10, data1: 36, data2: 100, type: 'noteOn' });
  });

  it('returns undefined for empty message', () => {
    expect(describeMidiMessage([])).toBeUndefined();
  });

  it('returns undefined for too-short message', () => {
    expect(describeMidiMessage([0x90])).toBeUndefined();
  });

  it('returns undefined for unknown status byte', () => {
    expect(describeMidiMessage([0xf0, 0, 0])).toBeUndefined();
  });

  it('parses program change', () => {
    const result = describeMidiMessage([0xc0, 42, 0]);
    expect(result).toEqual({ channel: 1, data1: 42, data2: 0, type: 'programChange' });
  });
});

describe('MidiInputManager handleMessage integration', () => {
  it('midi input keys follow expected format', () => {
    const key = resolveMidiInputKey('1', 'default');
    expect(key).toBe('midi:default:1');
  });

  it('midi cc keys use the control number', () => {
    const key = resolveMidiInputKey('cc:74', 'myport');
    expect(key).toBe('midi:myport:cc:74');
  });

  it('input registry returns fallback for unset values', () => {
    const value = getInputValue(resolveMidiInputKey('1', 'default'));
    expect(value).toBe(0);
  });

  it('tracks the latest note, velocity, and held-note count from raw messages', () => {
    applyMidiInputMessage([0x91, 60, 64], 'keyboard');
    applyMidiInputMessage([0x91, 67, 127], 'keyboard');

    expect(getHeldMidiNotes('keyboard')).toEqual([60, 67]);
    expect(getInputValue(resolveMidiInputKey('note', 'keyboard'))).toBe(67);
    expect(getInputValue(resolveMidiInputKey('keys', 'keyboard'))).toBe(2);
    expect(getInputValue(resolveMidiInputKey('velocity', 'keyboard'))).toBe(1);
    expect(getInputValue(resolveMidiInputKey('channel', 'keyboard'))).toBe(2);
    expect(getInputValue(resolveMidiInputKey('note:60', 'keyboard'))).toBeCloseTo(64 / 127);
  });

  it('releases notes for note-off and velocity-zero note-on messages', () => {
    applyMidiInputMessage([0x90, 60, 100], 'keyboard');
    applyMidiInputMessage([0x90, 67, 100], 'keyboard');
    applyMidiInputMessage([0x80, 60, 32], 'keyboard');

    expect(getHeldMidiNotes('keyboard')).toEqual([67]);
    expect(getInputValue(resolveMidiInputKey('keys', 'keyboard'))).toBe(1);
    expect(getInputValue(resolveMidiInputKey('note:60', 'keyboard'))).toBe(0);

    applyMidiInputMessage([0x90, 67, 0], 'keyboard');
    expect(getHeldMidiNotes('keyboard')).toEqual([]);
    expect(getInputValue(resolveMidiInputKey('keys', 'keyboard'))).toBe(0);
    expect(getInputValue(resolveMidiInputKey('note:67', 'keyboard'))).toBe(0);
  });
});
