import { createLogger, setMidiValue } from '@tussel/ir';

const midiInputLogger = createLogger('tussel/midi-input');

/**
 * MIDI input listener that feeds incoming MIDI messages into the Tussel input registry.
 *
 * This module provides an optional integration with MIDI hardware via the `@julusian/midi`
 * npm package. If the package is not installed, MIDI input is silently unavailable.
 *
 * Usage:
 * ```typescript
 * const input = new MidiInputManager();
 * input.openPort(0); // or input.openPort('My MIDI Controller')
 * // Now any CC or note messages update the input registry
 * // and can be read by patterns via midi()/cc() signal builders
 * input.closeAll();
 * ```
 */

interface MidiPort {
  close: () => void;
  name: string;
}

let midiModule: typeof import('@julusian/midi') | undefined;

async function getMidiModule(): Promise<typeof import('@julusian/midi') | undefined> {
  if (midiModule !== undefined) {
    return midiModule;
  }
  try {
    midiModule = await import('@julusian/midi');
    return midiModule;
  } catch {
    try {
      // Fallback to 'midi' package
      midiModule = await import('midi' as string);
      return midiModule;
    } catch {
      return undefined;
    }
  }
}

export class MidiInputManager {
  private ports: MidiPort[] = [];
  private warned = false;

  async listPorts(): Promise<string[]> {
    const midi = await getMidiModule();
    if (!midi) {
      this.warnMissing();
      return [];
    }

    try {
      const input = new midi.Input();
      const count = input.getPortCount();
      const names: string[] = [];
      for (let i = 0; i < count; i++) {
        names.push(input.getPortName(i));
      }
      input.closePort();
      return names;
    } catch {
      return [];
    }
  }

  async openPort(portOrIndex: number | string, midiPort = 'default'): Promise<boolean> {
    const midi = await getMidiModule();
    if (!midi) {
      this.warnMissing();
      return false;
    }

    try {
      const input = new midi.Input();
      let portIndex: number;

      if (typeof portOrIndex === 'number') {
        portIndex = portOrIndex;
      } else {
        const count = input.getPortCount();
        portIndex = -1;
        for (let i = 0; i < count; i++) {
          if (input.getPortName(i).includes(portOrIndex)) {
            portIndex = i;
            break;
          }
        }
        if (portIndex === -1) {
          midiInputLogger.warn(`port "${portOrIndex}" not found`, { code: 'TUSSEL_MIDI_INPUT_PORT_NOT_FOUND' });
          input.closePort();
          return false;
        }
      }

      const portName = input.getPortName(portIndex);
      input.openPort(portIndex);

      input.on('message', (_deltaTime: number, message: number[]) => {
        this.handleMessage(message, midiPort);
      });

      this.ports.push({
        close: () => input.closePort(),
        name: portName,
      });

      return true;
    } catch (error) {
      midiInputLogger.warn(
        `failed to open port: ${error instanceof Error ? error.message : String(error)}`,
        { code: 'TUSSEL_MIDI_INPUT_OPEN_FAILED' },
      );
      return false;
    }
  }

  closeAll(): void {
    for (const port of this.ports) {
      try {
        port.close();
      } catch {
        // Ignore close errors
      }
    }
    this.ports = [];
  }

  get openPortCount(): number {
    return this.ports.length;
  }

  private handleMessage(message: number[], port: string): void {
    if (!message || message.length < 2) {
      return;
    }

    const status = message[0] ?? 0;
    const statusType = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    const data1 = message[1] ?? 0;
    const data2 = message[2] ?? 0;

    switch (statusType) {
      case 0x90: // Note On
        if (data2 > 0) {
          setMidiValue(`note:${data1}`, data2 / 127, port);
          setMidiValue(`velocity`, data2 / 127, port);
          setMidiValue(`note`, data1, port);
          setMidiValue(`channel`, channel, port);
        } else {
          // Note On with velocity 0 = Note Off
          setMidiValue(`note:${data1}`, 0, port);
        }
        break;

      case 0x80: // Note Off
        setMidiValue(`note:${data1}`, 0, port);
        break;

      case 0xb0: // Control Change
        setMidiValue(`${data1}`, data2 / 127, port);
        setMidiValue(`cc:${data1}`, data2 / 127, port);
        break;

      case 0xe0: {
        // Pitch Bend
        const bend = ((data2 << 7) | data1) / 16383;
        setMidiValue('pitchbend', bend * 2 - 1, port);
        break;
      }

      case 0xd0: // Channel Pressure (Aftertouch)
        setMidiValue('pressure', data1 / 127, port);
        break;
    }
  }

  private warnMissing(): void {
    if (!this.warned) {
      this.warned = true;
      midiInputLogger.warn(
        'MIDI input unavailable. Install @julusian/midi for hardware MIDI support.',
      );
    }
  }
}

/**
 * Parse a raw MIDI message into a human-readable description.
 * Exported for testing.
 */
export function describeMidiMessage(
  message: number[],
): { channel: number; data1: number; data2: number; type: string } | undefined {
  if (!message || message.length < 2) {
    return undefined;
  }

  const status = message[0] ?? 0;
  const statusType = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const data1 = message[1] ?? 0;
  const data2 = message[2] ?? 0;

  const typeMap: Record<number, string> = {
    128: 'noteOff',
    144: data2 > 0 ? 'noteOn' : 'noteOff',
    160: 'polyPressure',
    176: 'cc',
    192: 'programChange',
    208: 'channelPressure',
    224: 'pitchBend',
  };

  const type = typeMap[statusType];
  if (!type) {
    return undefined;
  }

  return { channel, data1, data2, type };
}
