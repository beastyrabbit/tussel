import { getInputValue, resetInputRegistry, resolveMidiInputKey } from '@tussel/ir';
import { afterEach, describe, expect, it } from 'vitest';
import { describeMidiMessage } from './midi-input.js';

afterEach(() => {
  resetInputRegistry();
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
  // We can't test the full manager without the midi package,
  // but we can verify the input registry is correctly populated
  // by testing the key format used by the midi signal builders

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
});
