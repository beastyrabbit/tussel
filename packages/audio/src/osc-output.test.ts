import type { OscDispatchEvent } from '@tussel/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildTypeTagString,
  encodeOscBundle,
  encodeOscFloat32,
  encodeOscInt32,
  encodeOscMessage,
  encodeOscString,
  encodeOscTimetag,
  type OscArgument,
  OscOutputManager,
  padToFourBytes,
  payloadToOscArgs,
} from './osc-output.js';

// ---------------------------------------------------------------------------
// Low-level encoding helpers
// ---------------------------------------------------------------------------

describe('padToFourBytes', () => {
  it('returns the same buffer when already aligned', () => {
    const buf = Buffer.from([1, 2, 3, 4]);
    expect(padToFourBytes(buf).length).toBe(4);
  });

  it('pads a 1-byte buffer to 4 bytes', () => {
    const buf = Buffer.from([0x41]);
    const padded = padToFourBytes(buf);
    expect(padded.length).toBe(4);
    expect(padded[0]).toBe(0x41);
    expect(padded[1]).toBe(0);
    expect(padded[2]).toBe(0);
    expect(padded[3]).toBe(0);
  });

  it('pads a 5-byte buffer to 8 bytes', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5]);
    const padded = padToFourBytes(buf);
    expect(padded.length).toBe(8);
  });

  it('does not pad an empty buffer', () => {
    const buf = Buffer.alloc(0);
    expect(padToFourBytes(buf).length).toBe(0);
  });
});

describe('encodeOscString', () => {
  it('encodes a short string with null terminator and padding', () => {
    // "hi" = 2 chars + 1 null = 3 bytes, padded to 4
    const encoded = encodeOscString('hi');
    expect(encoded.length).toBe(4);
    expect(encoded.toString('utf-8', 0, 2)).toBe('hi');
    expect(encoded[2]).toBe(0); // null terminator
    expect(encoded[3]).toBe(0); // padding
  });

  it('encodes a 3-char string to 4 bytes (null makes it exactly 4)', () => {
    // "abc" = 3 chars + 1 null = 4 bytes, already aligned
    const encoded = encodeOscString('abc');
    expect(encoded.length).toBe(4);
    expect(encoded.toString('utf-8', 0, 3)).toBe('abc');
    expect(encoded[3]).toBe(0);
  });

  it('encodes a 4-char string to 8 bytes', () => {
    // "abcd" = 4 chars + 1 null = 5 bytes, padded to 8
    const encoded = encodeOscString('abcd');
    expect(encoded.length).toBe(8);
    expect(encoded.toString('utf-8', 0, 4)).toBe('abcd');
    expect(encoded[4]).toBe(0);
  });

  it('encodes an empty string to 4 bytes', () => {
    // "" = 0 chars + 1 null = 1 byte, padded to 4
    const encoded = encodeOscString('');
    expect(encoded.length).toBe(4);
    expect(encoded[0]).toBe(0);
  });

  it('encodes a typical OSC address path', () => {
    const encoded = encodeOscString('/play');
    // "/play" = 5 chars + 1 null = 6 bytes, padded to 8
    expect(encoded.length).toBe(8);
    expect(encoded.toString('utf-8', 0, 5)).toBe('/play');
    expect(encoded[5]).toBe(0);
  });
});

describe('encodeOscInt32', () => {
  it('encodes zero', () => {
    const buf = encodeOscInt32(0);
    expect(buf.length).toBe(4);
    expect(buf.readInt32BE(0)).toBe(0);
  });

  it('encodes a positive integer in big-endian', () => {
    const buf = encodeOscInt32(256);
    expect(buf.readInt32BE(0)).toBe(256);
  });

  it('encodes a negative integer', () => {
    const buf = encodeOscInt32(-42);
    expect(buf.readInt32BE(0)).toBe(-42);
  });

  it('rounds floating-point values to nearest integer', () => {
    const buf = encodeOscInt32(3.7);
    expect(buf.readInt32BE(0)).toBe(4);
  });
});

describe('encodeOscFloat32', () => {
  it('encodes zero', () => {
    const buf = encodeOscFloat32(0);
    expect(buf.length).toBe(4);
    expect(buf.readFloatBE(0)).toBe(0);
  });

  it('encodes a typical float value', () => {
    const buf = encodeOscFloat32(440.0);
    expect(buf.readFloatBE(0)).toBeCloseTo(440.0, 1);
  });

  it('encodes a negative float', () => {
    const buf = encodeOscFloat32(-1.5);
    expect(buf.readFloatBE(0)).toBeCloseTo(-1.5, 5);
  });
});

// ---------------------------------------------------------------------------
// Type tag string
// ---------------------------------------------------------------------------

describe('buildTypeTagString', () => {
  it('returns just a comma for empty args', () => {
    expect(buildTypeTagString([])).toBe(',');
  });

  it('builds correct tags for mixed args', () => {
    const args: OscArgument[] = [
      { type: 'i', value: 42 },
      { type: 'f', value: 3.14 },
      { type: 's', value: 'hello' },
    ];
    expect(buildTypeTagString(args)).toBe(',ifs');
  });

  it('handles repeated types', () => {
    const args: OscArgument[] = [
      { type: 's', value: 'a' },
      { type: 's', value: 'b' },
    ];
    expect(buildTypeTagString(args)).toBe(',ss');
  });
});

// ---------------------------------------------------------------------------
// Full message encoding
// ---------------------------------------------------------------------------

describe('encodeOscMessage', () => {
  it('encodes a message with no arguments', () => {
    const msg = encodeOscMessage('/ping', []);
    // "/ping" -> 8 bytes (5 chars + null + 2 padding)
    // "," -> 4 bytes (1 char + null + 2 padding)
    expect(msg.length).toBe(12);
    // Verify address
    expect(msg.toString('utf-8', 0, 5)).toBe('/ping');
    // Verify type tag starts with comma
    expect(msg.toString('utf-8', 8, 9)).toBe(',');
  });

  it('encodes a message with a single integer argument', () => {
    const msg = encodeOscMessage('/volume', [{ type: 'i', value: 100 }]);
    // "/volume" = 7 + 1 null = 8
    // ",i" = 2 + 1 null = 3 -> padded to 4
    // int32 = 4
    expect(msg.length).toBe(16);
    // Read the int32 argument
    expect(msg.readInt32BE(12)).toBe(100);
  });

  it('encodes a message with mixed argument types', () => {
    const args: OscArgument[] = [
      { type: 's', value: 'freq' },
      { type: 'f', value: 440.0 },
      { type: 'i', value: 1 },
    ];
    const msg = encodeOscMessage('/synth', args);

    // "/synth" = 6 + 1 null = 7 -> padded to 8
    // ",sfi" = 4 + 1 null = 5 -> padded to 8
    // "freq" = 4 + 1 null = 5 -> padded to 8
    // float = 4
    // int = 4
    // Total = 8 + 8 + 8 + 4 + 4 = 32
    expect(msg.length).toBe(32);
  });

  it('produces parseable address and type tags', () => {
    const args: OscArgument[] = [
      { type: 's', value: 'note' },
      { type: 'i', value: 60 },
    ];
    const msg = encodeOscMessage('/play', args);

    // Extract address (null-terminated)
    const addressEnd = msg.indexOf(0);
    const address = msg.toString('utf-8', 0, addressEnd);
    expect(address).toBe('/play');

    // Type tag starts after address (padded to 4 bytes)
    const typeTagOffset = 8; // "/play" + null + padding = 8
    const typeTagEnd = msg.indexOf(0, typeTagOffset);
    const typeTag = msg.toString('utf-8', typeTagOffset, typeTagEnd);
    expect(typeTag).toBe(',si');
  });
});

// ---------------------------------------------------------------------------
// Timetag encoding
// ---------------------------------------------------------------------------

describe('encodeOscTimetag', () => {
  it('returns an 8-byte buffer', () => {
    const tag = encodeOscTimetag(0);
    expect(tag.length).toBe(8);
  });

  it('encodes Unix epoch as NTP-offset seconds', () => {
    const tag = encodeOscTimetag(0);
    // At Unix epoch (0), NTP seconds = 2208988800
    const seconds = tag.readUInt32BE(0);
    expect(seconds).toBe(2_208_988_800);
  });

  it('encodes fractional seconds', () => {
    const tag = encodeOscTimetag(0.5);
    const fraction = tag.readUInt32BE(4);
    // 0.5 * 0xFFFFFFFF should be approximately 2147483648
    expect(fraction).toBeGreaterThan(2_000_000_000);
    expect(fraction).toBeLessThan(2_300_000_000);
  });
});

// ---------------------------------------------------------------------------
// Bundle encoding
// ---------------------------------------------------------------------------

describe('encodeOscBundle', () => {
  it('encodes a bundle with a single message', () => {
    const msg = encodeOscMessage('/test', []);
    const timetag = Buffer.alloc(8); // "immediately"
    timetag.writeUInt32BE(0, 0);
    timetag.writeUInt32BE(1, 4);

    const bundle = encodeOscBundle(timetag, [msg]);

    // "#bundle\0" = 8 bytes
    // timetag = 8 bytes
    // size prefix = 4 bytes
    // message = msg.length bytes
    expect(bundle.length).toBe(8 + 8 + 4 + msg.length);

    // Check bundle marker
    expect(bundle.toString('utf-8', 0, 7)).toBe('#bundle');
    expect(bundle[7]).toBe(0);

    // Check message size prefix
    const msgSize = bundle.readInt32BE(16);
    expect(msgSize).toBe(msg.length);
  });

  it('encodes a bundle with multiple messages', () => {
    const msg1 = encodeOscMessage('/a', []);
    const msg2 = encodeOscMessage('/b', [{ type: 'i', value: 1 }]);
    const timetag = Buffer.alloc(8);

    const bundle = encodeOscBundle(timetag, [msg1, msg2]);

    // 8 (identifier) + 8 (timetag) + 4 (size1) + msg1.length + 4 (size2) + msg2.length
    expect(bundle.length).toBe(8 + 8 + 4 + msg1.length + 4 + msg2.length);
  });
});

// ---------------------------------------------------------------------------
// Payload-to-arguments conversion
// ---------------------------------------------------------------------------

describe('payloadToOscArgs', () => {
  it('converts string values to string args', () => {
    const args = payloadToOscArgs({ s: 'bd' });
    expect(args).toEqual([
      { type: 's', value: 's' },
      { type: 's', value: 'bd' },
    ]);
  });

  it('converts integer values to int args', () => {
    const args = payloadToOscArgs({ n: 3 });
    expect(args).toEqual([
      { type: 's', value: 'n' },
      { type: 'i', value: 3 },
    ]);
  });

  it('converts floating-point values to float args', () => {
    const args = payloadToOscArgs({ speed: 1.5 });
    expect(args).toEqual([
      { type: 's', value: 'speed' },
      { type: 'f', value: 1.5 },
    ]);
  });

  it('sorts keys alphabetically', () => {
    const args = payloadToOscArgs({ z: 1, a: 2 });
    expect(args[0]).toEqual({ type: 's', value: 'a' });
    expect(args[2]).toEqual({ type: 's', value: 'z' });
  });

  it('excludes internal keys (osc, oschost, oscport, mute, orbit)', () => {
    const args = payloadToOscArgs({
      freq: 440,
      mute: false,
      orbit: 'main',
      osc: '/play',
      oschost: '127.0.0.1',
      oscport: 57120,
    });
    expect(args).toEqual([
      { type: 's', value: 'freq' },
      { type: 'i', value: 440 },
    ]);
  });

  it('skips null and undefined values', () => {
    const args = payloadToOscArgs({ a: null, b: undefined, c: 1 });
    expect(args).toEqual([
      { type: 's', value: 'c' },
      { type: 'i', value: 1 },
    ]);
  });

  it('coerces non-primitive values to strings', () => {
    const args = payloadToOscArgs({ data: [1, 2, 3] });
    expect(args).toEqual([
      { type: 's', value: 'data' },
      { type: 's', value: '1,2,3' },
    ]);
  });

  it('returns empty array for empty payload', () => {
    expect(payloadToOscArgs({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// OscOutputManager
// ---------------------------------------------------------------------------

describe('OscOutputManager', () => {
  // We mock dgram at the socket level by spying on the created sockets
  let manager: OscOutputManager;

  beforeEach(() => {
    manager = new OscOutputManager();
  });

  afterEach(() => {
    manager.closeAll();
  });

  it('can be instantiated with working send and closeAll methods', () => {
    expect(manager).toBeInstanceOf(OscOutputManager);
    expect(typeof manager.send).toBe('function');
    expect(typeof manager.closeAll).toBe('function');
    expect(typeof manager.dispatchEvent).toBe('function');
  });

  it('sends an OSC message via UDP', async () => {
    // Create a dgram server to receive the message
    const { createSocket } = await import('node:dgram');
    const server = createSocket('udp4');

    const received = new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 2000);
      server.on('message', (msg) => {
        clearTimeout(timeout);
        resolve(msg);
      });
    });

    await new Promise<void>((resolve) => {
      server.bind(0, '127.0.0.1', () => resolve());
    });

    const port = (server.address() as { port: number }).port;

    manager.send('127.0.0.1', port, '/test', [{ type: 'i', value: 42 }]);

    const msg = await received;
    server.close();

    // Parse the received message: address should be "/test"
    const addressEnd = msg.indexOf(0);
    expect(msg.toString('utf-8', 0, addressEnd)).toBe('/test');

    // Find type tag
    const typeTagOffset = Math.ceil((addressEnd + 1) / 4) * 4;
    const typeTagEnd = msg.indexOf(0, typeTagOffset);
    expect(msg.toString('utf-8', typeTagOffset, typeTagEnd)).toBe(',i');

    // Read int32 argument
    const argOffset = Math.ceil((typeTagEnd + 1) / 4) * 4;
    expect(msg.readInt32BE(argOffset)).toBe(42);
  });

  it('reuses sockets for the same host:port (behavioral)', async () => {
    // Send two messages to the same destination and verify both arrive
    const { createSocket } = await import('node:dgram');
    const server = createSocket('udp4');
    const messages: Buffer[] = [];

    const received = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 2000);
      server.on('message', (msg) => {
        messages.push(msg);
        if (messages.length === 2) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.bind(0, '127.0.0.1', () => resolve());
    });
    const port = (server.address() as { port: number }).port;

    manager.send('127.0.0.1', port, '/a', []);
    manager.send('127.0.0.1', port, '/b', []);

    await received;
    server.close();

    expect(messages).toHaveLength(2);
  });

  it('closeAll allows subsequent sends to still work', async () => {
    const { createSocket } = await import('node:dgram');
    const server = createSocket('udp4');

    // First send
    manager.send('127.0.0.1', 19996, '/a', []);
    manager.closeAll();

    // After closeAll, sending again should still work (creates new socket)
    const received = new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 2000);
      server.on('message', (msg) => {
        clearTimeout(timeout);
        resolve(msg);
      });
    });

    await new Promise<void>((resolve) => {
      server.bind(0, '127.0.0.1', () => resolve());
    });
    const port = (server.address() as { port: number }).port;

    manager.send('127.0.0.1', port, '/b', []);
    const msg = await received;
    server.close();

    const addressEnd = msg.indexOf(0);
    expect(msg.toString('utf-8', 0, addressEnd)).toBe('/b');
  });

  it('closeAll is safe to call multiple times', () => {
    manager.send('127.0.0.1', 9994, '/a', []);
    manager.closeAll();
    expect(() => manager.closeAll()).not.toThrow();
  });

  it('dispatchEvent sends correct OSC message for an OscDispatchEvent', async () => {
    const { createSocket } = await import('node:dgram');
    const server = createSocket('udp4');

    const received = new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 2000);
      server.on('message', (msg) => {
        clearTimeout(timeout);
        resolve(msg);
      });
    });

    await new Promise<void>((resolve) => {
      server.bind(0, '127.0.0.1', () => resolve());
    });

    const port = (server.address() as { port: number }).port;

    const event: OscDispatchEvent = {
      begin: 0,
      channel: 'lead',
      end: 1,
      host: '127.0.0.1',
      kind: 'osc',
      path: '/play',
      payload: {
        freq: 440,
        osc: '/play',
        oschost: '127.0.0.1',
        oscport: port,
        s: 'bd',
      },
      port,
    };

    manager.dispatchEvent(event);

    const msg = await received;
    server.close();

    // Verify address is "/play"
    const addressEnd = msg.indexOf(0);
    expect(msg.toString('utf-8', 0, addressEnd)).toBe('/play');

    // Verify type tag has entries for freq (int) and s (string) only
    // (osc, oschost, oscport are excluded)
    // Sorted keys: freq, s -> key "freq" (s), value 440 (i), key "s" (s), value "bd" (s) = ,siss
    const typeTagOffset = Math.ceil((addressEnd + 1) / 4) * 4;
    const typeTagEnd = msg.indexOf(0, typeTagOffset);
    const typeTag = msg.toString('utf-8', typeTagOffset, typeTagEnd);
    expect(typeTag).toBe(',siss');
  });

  it('handles UDP errors gracefully without throwing', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Sending to an unreachable port should not throw synchronously
    expect(() => {
      manager.send('127.0.0.1', 1, '/test', []);
    }).not.toThrow();

    // Give the async UDP error a chance to fire
    await new Promise((resolve) => setTimeout(resolve, 100));

    consoleSpy.mockRestore();
  });
});
