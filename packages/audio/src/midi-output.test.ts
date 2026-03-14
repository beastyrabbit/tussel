import type { MidiCcDispatchEvent, MidiNoteDispatchEvent } from '@tussel/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type MidiOutputFactory, MidiOutputManager, type MidiOutputPort } from './midi-output.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockPort(overrides: Partial<MidiOutputPort> = {}): MidiOutputPort {
  return {
    closePort: vi.fn(),
    getPortCount: vi.fn(() => 0),
    getPortName: vi.fn(() => ''),
    isPortOpen: vi.fn(() => true),
    openPort: vi.fn(),
    openVirtualPort: vi.fn(),
    sendMessage: vi.fn(),
    ...overrides,
  };
}

function createMockFactory(port: MidiOutputPort): MidiOutputFactory {
  return () => port;
}

function createMultiPortFactory(ports: MidiOutputPort[]): MidiOutputFactory {
  let index = 0;
  return () => {
    const port = ports[index % ports.length]!;
    index++;
    return port;
  };
}

function makeNoteEvent(overrides: Partial<MidiNoteDispatchEvent> = {}): MidiNoteDispatchEvent {
  return {
    begin: 0,
    channel: 'test',
    channelNumber: 1,
    end: 1,
    kind: 'midi-note',
    note: 60,
    payload: {},
    port: 'default',
    velocity: 100,
    ...overrides,
  };
}

function makeCcEvent(overrides: Partial<MidiCcDispatchEvent> = {}): MidiCcDispatchEvent {
  return {
    begin: 0,
    channel: 'test',
    channelNumber: 1,
    control: 74,
    end: 1,
    kind: 'midi-cc',
    payload: {},
    port: 'default',
    value: 64,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MidiOutputManager', () => {
  describe('listPorts', () => {
    it('returns available system ports', () => {
      const probe = createMockPort({
        getPortCount: vi.fn(() => 2),
        getPortName: vi.fn((i: number) => (i === 0 ? 'Synth A' : 'Drum Machine')),
      });
      const manager = new MidiOutputManager(createMockFactory(probe));

      const ports = manager.listPorts();
      expect(ports).toEqual([
        { index: 0, name: 'Synth A' },
        { index: 1, name: 'Drum Machine' },
      ]);
    });

    it('returns empty list when no ports are available', () => {
      const probe = createMockPort({ getPortCount: vi.fn(() => 0) });
      const manager = new MidiOutputManager(createMockFactory(probe));

      expect(manager.listPorts()).toEqual([]);
    });
  });

  describe('openPort', () => {
    it('opens a virtual port for the "default" name', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      const opened = manager.openPort('default');
      expect(opened).toBe(port);
      expect(port.openVirtualPort).toHaveBeenCalledWith('tussel');
    });

    it('matches system ports by case-insensitive substring', () => {
      // openPort(name) calls factory() first to create the output port,
      // then getProbe() calls factory() again for the probe. So the
      // output port is the first factory result.
      const outputPort = createMockPort();
      const probePort = createMockPort({
        getPortCount: vi.fn(() => 2),
        getPortName: vi.fn((i: number) => (i === 0 ? 'USB MIDI Interface' : 'Virtual Synth')),
      });
      const manager = new MidiOutputManager(createMultiPortFactory([outputPort, probePort]));

      const opened = manager.openPort('virtual synth');
      expect(opened).toBe(outputPort);
      expect(outputPort.openPort).toHaveBeenCalledWith(1);
    });

    it('returns undefined and warns when port is not found', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const port = createMockPort({ getPortCount: vi.fn(() => 0) });
      const manager = new MidiOutputManager(createMockFactory(port));

      const opened = manager.openPort('nonexistent');
      expect(opened).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledOnce();
    });

    it('reuses already-open ports', () => {
      const port = createMockPort();
      const factory = vi.fn(createMockFactory(port));
      const manager = new MidiOutputManager(factory);

      manager.openPort('default');
      manager.openPort('default');

      // Factory called twice: once for the probe (listPorts/getProbe), once for the actual port.
      // The second openPort('default') should reuse the cached port, not call factory again.
      const totalCalls = factory.mock.calls.length;
      manager.openPort('default');
      expect(factory).toHaveBeenCalledTimes(totalCalls);
    });
  });

  describe('closeAll', () => {
    it('closes all open ports', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      manager.openPort('default');
      manager.closeAll();

      expect(port.closePort).toHaveBeenCalled();
    });
  });

  describe('sendNoteOn', () => {
    it('sends correct MIDI bytes for channel 1 middle C at velocity 100', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      manager.sendNoteOn(1, 60, 100);

      // Channel 1 -> status nibble 0 -> 0x90 | 0x00 = 0x90 = 144
      expect(port.sendMessage).toHaveBeenCalledWith([0x90, 60, 100]);
    });

    it('maps 1-indexed channel to 0-indexed MIDI status byte', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      manager.sendNoteOn(10, 60, 100);

      // Channel 10 -> status nibble 9 -> 0x90 | 0x09 = 0x99 = 153
      expect(port.sendMessage).toHaveBeenCalledWith([0x99, 60, 100]);
    });

    it('handles channel 16 (max)', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      manager.sendNoteOn(16, 60, 100);

      // Channel 16 -> status nibble 15 -> 0x90 | 0x0F = 0x9F = 159
      expect(port.sendMessage).toHaveBeenCalledWith([0x9f, 60, 100]);
    });
  });

  describe('sendNoteOff', () => {
    it('sends correct MIDI bytes with velocity 0', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      manager.sendNoteOff(1, 60);

      // 0x80 = Note Off on channel 1 (0-indexed 0)
      expect(port.sendMessage).toHaveBeenCalledWith([0x80, 60, 0]);
    });

    it('uses correct channel for Note Off', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      manager.sendNoteOff(5, 72);

      // Channel 5 -> nibble 4 -> 0x80 | 0x04 = 0x84 = 132
      expect(port.sendMessage).toHaveBeenCalledWith([0x84, 72, 0]);
    });
  });

  describe('sendCC', () => {
    it('sends correct Control Change bytes', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      manager.sendCC(1, 74, 64);

      // 0xB0 = CC on channel 1 (0-indexed 0), control 74, value 64
      expect(port.sendMessage).toHaveBeenCalledWith([0xb0, 74, 64]);
    });

    it('clamps control and value to 0-127', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      manager.sendCC(1, 200, 300);

      expect(port.sendMessage).toHaveBeenCalledWith([0xb0, 127, 127]);
    });

    it('clamps negative values to 0', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      manager.sendCC(1, -5, -10);

      expect(port.sendMessage).toHaveBeenCalledWith([0xb0, 0, 0]);
    });
  });

  describe('clamping', () => {
    it('clamps note values to 0-127', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      manager.sendNoteOn(1, 200, 100);
      expect(port.sendMessage).toHaveBeenCalledWith([0x90, 127, 100]);

      manager.sendNoteOn(1, -5, 100);
      expect(port.sendMessage).toHaveBeenCalledWith([0x90, 0, 100]);
    });

    it('clamps velocity to 0-127', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      manager.sendNoteOn(1, 60, 200);
      expect(port.sendMessage).toHaveBeenCalledWith([0x90, 60, 127]);

      manager.sendNoteOn(1, 60, -10);
      expect(port.sendMessage).toHaveBeenCalledWith([0x90, 60, 0]);
    });

    it('clamps channel below 1 to channel 1 (status nibble 0)', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      manager.sendNoteOn(0, 60, 100);
      // channel 0 -> clamp: max(0, min(15, 0-1)) = max(0, -1) = 0 -> 0x90
      expect(port.sendMessage).toHaveBeenCalledWith([0x90, 60, 100]);
    });

    it('clamps channel above 16 to channel 16 (status nibble 15)', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      manager.sendNoteOn(20, 60, 100);
      // channel 20 -> clamp: max(0, min(15, 20-1)) = max(0, 15) = 15 -> 0x9F
      expect(port.sendMessage).toHaveBeenCalledWith([0x9f, 60, 100]);
    });

    it('rounds fractional values', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      manager.sendNoteOn(1, 60.7, 99.3);
      expect(port.sendMessage).toHaveBeenCalledWith([0x90, 61, 99]);
    });
  });

  describe('dispatchEvent', () => {
    it('sends Note On for midi-note events and returns noteOff thunk', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      const noteOff = manager.dispatchEvent(makeNoteEvent({ channelNumber: 3, note: 64, velocity: 110 }));

      expect(port.sendMessage).toHaveBeenCalledWith([0x92, 64, 110]);
      expect(noteOff).toBeTypeOf('function');

      // Invoke the noteOff thunk
      noteOff?.();
      expect(port.sendMessage).toHaveBeenCalledWith([0x82, 64, 0]);
    });

    it('sends CC for midi-cc events and returns undefined', () => {
      const port = createMockPort();
      const manager = new MidiOutputManager(createMockFactory(port));

      const result = manager.dispatchEvent(makeCcEvent({ channelNumber: 2, control: 7, value: 100 }));

      expect(port.sendMessage).toHaveBeenCalledWith([0xb1, 7, 100]);
      expect(result).toBeUndefined();
    });

    it('uses the event port name for routing', () => {
      // openPort calls factory() for output first, then getProbe() for the probe
      const synthPort = createMockPort();
      const probePort = createMockPort({
        getPortCount: vi.fn(() => 1),
        getPortName: vi.fn(() => 'My Synth'),
      });
      const manager = new MidiOutputManager(createMultiPortFactory([synthPort, probePort]));

      manager.dispatchEvent(makeNoteEvent({ port: 'synth' }));

      expect(synthPort.sendMessage).toHaveBeenCalledOnce();
    });

    it('does not send when port cannot be resolved', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const port = createMockPort({ getPortCount: vi.fn(() => 0) });
      const manager = new MidiOutputManager(createMockFactory(port));

      const result = manager.dispatchEvent(makeNoteEvent({ port: 'nonexistent' }));

      // sendMessage should NOT have been called (no port to send to)
      expect(port.sendMessage).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });
  });

  describe('port selection', () => {
    it('different port names open different ports', () => {
      // Factory call order for the first sendNoteOn('synth'):
      //   1. openPort('synth') calls factory() -> synthOutput (the port to write to)
      //   2. getProbe() calls factory() -> probe (the port used for enumeration)
      // For the second sendCC('drums'):
      //   3. openPort('drums') calls factory() -> drumsOutput
      //   (probe is already cached)
      const synthOutput = createMockPort();
      const probe = createMockPort({
        getPortCount: vi.fn(() => 2),
        getPortName: vi.fn((i: number) => (i === 0 ? 'Synth' : 'Drums')),
      });
      const drumsOutput = createMockPort();
      const manager = new MidiOutputManager(createMultiPortFactory([synthOutput, probe, drumsOutput]));

      manager.sendNoteOn(1, 60, 100, 'synth');
      manager.sendCC(10, 1, 64, 'drums');

      expect(synthOutput.sendMessage).toHaveBeenCalledWith([0x90, 60, 100]);
      expect(drumsOutput.sendMessage).toHaveBeenCalledWith([0xb9, 1, 64]);
    });
  });
});
