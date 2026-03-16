import { createSocket, type Socket } from 'node:dgram';
import type { OscDispatchEvent } from '@tussel/core';
import { createLogger } from '@tussel/ir';

const oscLogger = createLogger('tussel/osc');

// ---------------------------------------------------------------------------
// OSC argument types
// ---------------------------------------------------------------------------

export type OscArgument = OscFloat | OscInt | OscString;

interface OscInt {
  type: 'i';
  value: number;
}

interface OscFloat {
  type: 'f';
  value: number;
}

interface OscString {
  type: 's';
  value: string;
}

// ---------------------------------------------------------------------------
// OSC message encoding helpers
// ---------------------------------------------------------------------------

/**
 * Pad a buffer to the next 4-byte boundary with zero bytes.
 */
export function padToFourBytes(buf: Buffer): Buffer {
  const remainder = buf.length % 4;
  if (remainder === 0) {
    return buf;
  }
  const padding = Buffer.alloc(4 - remainder);
  return Buffer.concat([buf, padding]);
}

/**
 * Encode an OSC string (null-terminated, padded to 4-byte boundary).
 */
export function encodeOscString(value: string): Buffer {
  // OSC strings are null-terminated and padded to 4-byte boundary.
  // The null terminator is always included, then padded.
  const strBuf = Buffer.from(value, 'utf-8');
  const withNull = Buffer.alloc(strBuf.length + 1);
  strBuf.copy(withNull);
  // withNull already has trailing zero from alloc
  return padToFourBytes(withNull);
}

/**
 * Encode an OSC int32 argument (big-endian).
 */
export function encodeOscInt32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(Math.round(value), 0);
  return buf;
}

/**
 * Encode an OSC float32 argument (big-endian).
 */
export function encodeOscFloat32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(value, 0);
  return buf;
}

/**
 * Encode a single OSC argument into its binary representation.
 */
export function encodeOscArgument(arg: OscArgument): Buffer {
  switch (arg.type) {
    case 'i':
      return encodeOscInt32(arg.value);
    case 'f':
      return encodeOscFloat32(arg.value);
    case 's':
      return encodeOscString(arg.value);
  }
}

/**
 * Build the OSC type tag string from an array of arguments.
 * Returns e.g. ",ifs" for [int, float, string].
 */
export function buildTypeTagString(args: OscArgument[]): string {
  return `,${args.map((a) => a.type).join('')}`;
}

/**
 * Encode a complete OSC message: address pattern + type tag string + arguments.
 */
export function encodeOscMessage(address: string, args: OscArgument[]): Buffer {
  const parts: Buffer[] = [];

  // Address pattern (must start with /)
  parts.push(encodeOscString(address));

  // Type tag string
  parts.push(encodeOscString(buildTypeTagString(args)));

  // Arguments
  for (const arg of args) {
    parts.push(encodeOscArgument(arg));
  }

  return Buffer.concat(parts);
}

// OSC timetag for "immediately" (1 Jan 1900 epoch offset = 0, fraction = 1)
const OSC_TIMETAG_IMMEDIATELY = Buffer.alloc(8);
OSC_TIMETAG_IMMEDIATELY.writeUInt32BE(0, 0);
OSC_TIMETAG_IMMEDIATELY.writeUInt32BE(1, 4);

/**
 * Encode an OSC timetag from a Unix timestamp in seconds.
 * OSC uses NTP epoch (1 Jan 1900), so we add 70 years of seconds.
 */
export function encodeOscTimetag(unixSeconds: number): Buffer {
  const buf = Buffer.alloc(8);
  // Offset between NTP epoch (1 Jan 1900) and Unix epoch (1 Jan 1970)
  const NTP_OFFSET = 2_208_988_800;
  const ntpTime = unixSeconds + NTP_OFFSET;
  const seconds = Math.floor(ntpTime);
  const fraction = Math.round((ntpTime - seconds) * 0xffffffff);
  buf.writeUInt32BE(seconds >>> 0, 0);
  buf.writeUInt32BE(fraction >>> 0, 4);
  return buf;
}

/**
 * Encode an OSC bundle: "#bundle" + timetag + size-prefixed messages.
 */
export function encodeOscBundle(timetag: Buffer, messages: Buffer[]): Buffer {
  const parts: Buffer[] = [];

  // Bundle identifier
  parts.push(encodeOscString('#bundle'));

  // Timetag (8 bytes, already padded to 4-byte boundary)
  parts.push(timetag);

  // Each bundle element is prefixed with its size as int32
  for (const msg of messages) {
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeInt32BE(msg.length, 0);
    parts.push(sizeBuf);
    parts.push(msg);
  }

  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Payload-to-arguments conversion
// ---------------------------------------------------------------------------

// Keys that are internal metadata, not OSC arguments
const EXCLUDED_PAYLOAD_KEYS = new Set(['osc', 'oschost', 'oscport', 'mute', 'orbit']);

/**
 * Convert an OscDispatchEvent's payload into a flat array of OSC arguments.
 * Each key-value pair becomes two arguments: a string key followed by
 * a typed value (int, float, or string).
 */
export function payloadToOscArgs(payload: Record<string, unknown>): OscArgument[] {
  const args: OscArgument[] = [];

  const sortedKeys = Object.keys(payload).sort();
  for (const key of sortedKeys) {
    if (EXCLUDED_PAYLOAD_KEYS.has(key)) {
      continue;
    }

    const value = payload[key];
    if (value === undefined || value === null) {
      continue;
    }

    // Key is always a string argument
    args.push({ type: 's', value: key });

    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        args.push({ type: 'i', value });
      } else {
        args.push({ type: 'f', value });
      }
    } else if (typeof value === 'string') {
      args.push({ type: 's', value });
    } else {
      // Coerce anything else to string
      args.push({ type: 's', value: String(value) });
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// OscOutputManager: manages UDP sockets and sends OSC messages
// ---------------------------------------------------------------------------

interface SocketCacheEntry {
  socket: Socket;
  lastUsed: number;
}

/**
 * Manages UDP sockets for sending OSC messages. Sockets are lazily created
 * per (host, port) pair and cached for reuse. Provides a `dispatchEvent`
 * method that converts `OscDispatchEvent` objects into OSC messages.
 */
export class OscOutputManager {
  private readonly sockets = new Map<string, SocketCacheEntry>();

  /**
   * Get or create a UDP socket for the given host:port pair.
   */
  private getSocket(host: string, port: number): Socket {
    const key = `${host}:${port}`;
    const existing = this.sockets.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.socket;
    }

    const socket = createSocket('udp4');
    // Don't let the socket keep the process alive
    socket.unref();
    // Suppress errors to avoid crashing the audio engine
    socket.on('error', (err) => {
      oscLogger.error(`UDP error for ${key}: ${err.message}`, { code: 'TUSSEL_OSC_UDP_ERROR' });
    });

    this.sockets.set(key, { socket, lastUsed: Date.now() });
    return socket;
  }

  /**
   * Send a raw OSC message (or bundle) to the given host and port.
   */
  send(host: string, port: number, address: string, args: OscArgument[]): void {
    const message = encodeOscMessage(address, args);
    const socket = this.getSocket(host, port);
    socket.send(message, 0, message.length, port, host);
  }

  /**
   * Dispatch an OscDispatchEvent by converting its payload to OSC arguments
   * and sending to the event's host:port.
   */
  dispatchEvent(event: OscDispatchEvent): void {
    const args = payloadToOscArgs(event.payload);
    this.send(event.host, event.port, event.path, args);
  }

  /**
   * Close all cached sockets. Should be called on engine shutdown.
   */
  closeAll(): void {
    for (const [, entry] of this.sockets) {
      try {
        entry.socket.close();
      } catch {
        // Socket may already be closed
      }
    }
    this.sockets.clear();
  }
}
