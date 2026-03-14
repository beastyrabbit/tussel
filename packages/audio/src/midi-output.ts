import type { MidiCcDispatchEvent, MidiNoteDispatchEvent } from '@tussel/core';
import pc from 'picocolors';

/**
 * Minimal interface for an output port from `@julusian/midi`.
 * We declare this ourselves so the rest of the file compiles even when the
 * native addon is unavailable.
 */
export interface MidiOutputPort {
  closePort(): void;
  getPortCount(): number;
  getPortName(port: number): string;
  isPortOpen(): boolean;
  openPort(port: number): void;
  openVirtualPort(name: string): void;
  sendMessage(message: number[]): void;
}

/** Factory that creates a fresh Output instance. Injected at construction time. */
export type MidiOutputFactory = () => MidiOutputPort;

export interface MidiPortInfo {
  index: number;
  name: string;
}

/**
 * Manages MIDI output ports and translates high-level dispatch events into raw
 * MIDI messages sent to hardware or virtual ports.
 *
 * Port lookup is lazy: the first time a named port is referenced it is opened
 * and cached. The special name `"default"` opens a virtual port named
 * `"tussel"` on platforms that support it (Linux ALSA, macOS CoreMIDI).
 */
export class MidiOutputManager {
  private readonly factory: MidiOutputFactory;
  private readonly openPorts = new Map<string, MidiOutputPort>();
  private probe: MidiOutputPort | undefined;

  constructor(factory: MidiOutputFactory) {
    this.factory = factory;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Enumerate the system's available MIDI output ports. */
  listPorts(): MidiPortInfo[] {
    const probe = this.getProbe();
    const count = probe.getPortCount();
    const ports: MidiPortInfo[] = [];
    for (let i = 0; i < count; i++) {
      ports.push({ index: i, name: probe.getPortName(i) });
    }
    return ports;
  }

  /**
   * Open a port by logical name. The `name` is matched against the system port
   * list (case-insensitive substring). If `name` is `"default"`, a virtual
   * port named `"tussel"` is created instead.
   *
   * Returns the opened port, or `undefined` if no matching system port was
   * found.
   */
  openPort(name: string): MidiOutputPort | undefined {
    const existing = this.openPorts.get(name);
    if (existing?.isPortOpen()) {
      return existing;
    }

    const output = this.factory();

    if (name === 'default') {
      output.openVirtualPort('tussel');
      this.openPorts.set(name, output);
      return output;
    }

    const probe = this.getProbe();
    const count = probe.getPortCount();
    const lower = name.toLowerCase();

    for (let i = 0; i < count; i++) {
      if (probe.getPortName(i).toLowerCase().includes(lower)) {
        output.openPort(i);
        this.openPorts.set(name, output);
        return output;
      }
    }

    console.warn(pc.yellow(`[tussel] MIDI output port not found: "${name}"`));
    return undefined;
  }

  /** Close every open output port and release resources. */
  closeAll(): void {
    for (const port of this.openPorts.values()) {
      try {
        port.closePort();
      } catch {
        // best-effort cleanup
      }
    }
    this.openPorts.clear();

    if (this.probe) {
      try {
        this.probe.closePort();
      } catch {
        // best-effort
      }
      this.probe = undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Low-level send helpers
  // ---------------------------------------------------------------------------

  /** Send a Note On message. `channel` is 1-indexed (1..16). */
  sendNoteOn(channel: number, note: number, velocity: number, portName = 'default'): void {
    const port = this.resolvePort(portName);
    if (!port) return;
    const status = 0x90 | (clampChannel(channel) & 0x0f);
    port.sendMessage([status, clamp7(note), clamp7(velocity)]);
  }

  /** Send a Note Off message. `channel` is 1-indexed (1..16). */
  sendNoteOff(channel: number, note: number, portName = 'default'): void {
    const port = this.resolvePort(portName);
    if (!port) return;
    const status = 0x80 | (clampChannel(channel) & 0x0f);
    port.sendMessage([status, clamp7(note), 0]);
  }

  /** Send a Control Change message. `channel` is 1-indexed (1..16). */
  sendCC(channel: number, control: number, value: number, portName = 'default'): void {
    const port = this.resolvePort(portName);
    if (!port) return;
    const status = 0xb0 | (clampChannel(channel) & 0x0f);
    port.sendMessage([status, clamp7(control), clamp7(value)]);
  }

  // ---------------------------------------------------------------------------
  // High-level event dispatch
  // ---------------------------------------------------------------------------

  /**
   * Dispatch a core engine MIDI event. For note events this sends Note On
   * immediately and returns a callback that should be invoked later to send
   * the corresponding Note Off. Returns `undefined` if the target port could
   * not be resolved or if the event is a CC message (no follow-up needed).
   */
  dispatchEvent(event: MidiCcDispatchEvent | MidiNoteDispatchEvent): (() => void) | undefined {
    const port = this.resolvePort(event.port);
    if (!port) {
      return undefined;
    }

    if (event.kind === 'midi-cc') {
      const status = 0xb0 | (clampChannel(event.channelNumber) & 0x0f);
      port.sendMessage([status, clamp7(event.control), clamp7(event.value)]);
      return undefined;
    }

    // midi-note: send Note On now, return a thunk for Note Off.
    const ch = clampChannel(event.channelNumber) & 0x0f;
    const note = clamp7(event.note);
    port.sendMessage([0x90 | ch, note, clamp7(event.velocity)]);

    return () => {
      // Re-resolve the port in case it was closed between note-on and note-off
      const offPort = this.resolvePort(event.port);
      if (offPort) {
        offPort.sendMessage([0x80 | ch, note, 0]);
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private getProbe(): MidiOutputPort {
    if (!this.probe) {
      this.probe = this.factory();
    }
    return this.probe;
  }

  private resolvePort(name: string): MidiOutputPort | undefined {
    const existing = this.openPorts.get(name);
    if (existing?.isPortOpen()) {
      return existing;
    }
    return this.openPort(name);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a 1-indexed MIDI channel (1..16) to a 0-indexed nibble (0..15). */
function clampChannel(ch: number): number {
  return Math.max(0, Math.min(15, Math.round(ch) - 1));
}

/** Clamp an integer to the 7-bit MIDI data range 0..127. */
function clamp7(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Factory with graceful fallback
// ---------------------------------------------------------------------------

let cachedFactory: MidiOutputFactory | undefined;
let factoryResolved = false;

/**
 * Attempt to load `@julusian/midi` and return a factory for creating output
 * ports. Returns `undefined` if the native addon is not installed or cannot be
 * loaded. The result is cached after the first call.
 */
export async function loadMidiOutputFactory(): Promise<MidiOutputFactory | undefined> {
  if (factoryResolved) {
    return cachedFactory;
  }
  factoryResolved = true;

  try {
    // Dynamic import so the rest of the bundle works without the native addon.
    const mod = await import('@julusian/midi');
    const OutputClass = mod.Output ?? (mod.default as { Output: new () => MidiOutputPort })?.Output;
    if (!OutputClass) {
      console.warn(pc.yellow('[tussel] @julusian/midi loaded but Output class not found'));
      return undefined;
    }
    cachedFactory = () => new OutputClass() as MidiOutputPort;
    return cachedFactory;
  } catch {
    console.warn(
      pc.yellow('[tussel] MIDI output unavailable — install @julusian/midi for hardware MIDI support'),
    );
    return undefined;
  }
}

/**
 * Reset the cached factory. Intended for testing only.
 * @internal
 */
export function _resetMidiFactory(): void {
  cachedFactory = undefined;
  factoryResolved = false;
}
