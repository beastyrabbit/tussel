export * from './csound.js';
export * from './errors.js';
export * from './hydra.js';
export * from './input.js';

import { TusselValidationError } from './errors.js';

export type PrimitiveValue = boolean | null | number | string;
export type ExprType = 'pattern' | 'scene' | 'signal' | 'value';

export interface CallExpressionNode {
  args: ExpressionValue[];
  exprType: ExprType;
  kind: 'call';
  name: string;
}

export interface MethodExpressionNode {
  args: ExpressionValue[];
  exprType: ExprType;
  kind: 'method';
  name: string;
  target: ExpressionValue;
}

export type ExpressionNode = CallExpressionNode | MethodExpressionNode;
export type ExpressionRecord = { [key: string]: ExpressionValue };
export type ExpressionValue = ExpressionNode | ExpressionRecord | ExpressionValue[] | PrimitiveValue;

export interface SampleManifest {
  _base?: string;
  [key: string]: string | string[] | undefined;
}

export interface SampleSourceSpec {
  ref: string;
}

export interface TransportSpec {
  bpm?: ExpressionValue;
  cps?: ExpressionValue;
}

export interface ChannelSpec {
  gain?: ExpressionValue;
  mute?: boolean;
  node: ExpressionValue;
  orbit?: string;
}

export interface MasterSpec {
  delay?: ExpressionValue;
  gain?: ExpressionValue;
  room?: ExpressionValue;
  size?: ExpressionValue;
}

export interface MetadataSpec {
  [key: string]: ExpressionValue;
}

export interface SceneSpec {
  channels: Record<string, ChannelSpec>;
  master?: MasterSpec;
  metadata?: MetadataSpec;
  samples: SampleSourceSpec[];
  transport: TransportSpec;
}

export interface SceneInput {
  channels?: Record<string, ChannelSpec | ExpressionValue>;
  master?: MasterSpec;
  metadata?: MetadataSpec;
  root?: ExpressionValue;
  samples?: Array<SampleSourceSpec | string>;
  transport?: TransportSpec;
}

export const sceneSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  additionalProperties: false,
  properties: {
    channels: {
      additionalProperties: {
        anyOf: [{ $ref: '#/$defs/channel' }, { $ref: '#/$defs/value' }],
      },
      type: 'object',
    },
    master: { $ref: '#/$defs/objectValue' },
    metadata: { $ref: '#/$defs/objectValue' },
    root: { $ref: '#/$defs/value' },
    samples: {
      items: {
        anyOf: [
          { type: 'string' },
          {
            additionalProperties: false,
            properties: {
              ref: { type: 'string' },
            },
            required: ['ref'],
            type: 'object',
          },
        ],
      },
      type: 'array',
    },
    transport: { $ref: '#/$defs/objectValue' },
  },
  required: ['channels', 'samples', 'transport'],
  type: 'object',
  $defs: {
    callExpr: {
      additionalProperties: false,
      properties: {
        args: { items: { $ref: '#/$defs/value' }, type: 'array' },
        exprType: { enum: ['pattern', 'scene', 'signal', 'value'] },
        kind: { const: 'call' },
        name: { type: 'string' },
      },
      required: ['kind', 'name', 'args', 'exprType'],
      type: 'object',
    },
    methodExpr: {
      additionalProperties: false,
      properties: {
        args: { items: { $ref: '#/$defs/value' }, type: 'array' },
        exprType: { enum: ['pattern', 'scene', 'signal', 'value'] },
        kind: { const: 'method' },
        name: { type: 'string' },
        target: { $ref: '#/$defs/value' },
      },
      required: ['kind', 'name', 'target', 'args', 'exprType'],
      type: 'object',
    },
    channel: {
      additionalProperties: false,
      properties: {
        gain: { $ref: '#/$defs/value' },
        mute: { type: 'boolean' },
        node: { $ref: '#/$defs/value' },
        orbit: { type: 'string' },
      },
      required: ['node'],
      type: 'object',
    },
    objectValue: {
      additionalProperties: { $ref: '#/$defs/value' },
      type: 'object',
    },
    value: {
      anyOf: [
        { type: 'string' },
        { type: 'number' },
        { type: 'boolean' },
        { type: 'null' },
        { items: { $ref: '#/$defs/value' }, type: 'array' },
        { $ref: '#/$defs/callExpr' },
        { $ref: '#/$defs/methodExpr' },
        { $ref: '#/$defs/objectValue' },
      ],
    },
  },
} as const;

export function createCallExpression(
  name: string,
  args: ExpressionValue[],
  exprType: ExprType = 'value',
): CallExpressionNode {
  return { kind: 'call', name, args, exprType };
}

export function createMethodExpression(
  target: ExpressionValue,
  name: string,
  args: ExpressionValue[],
  exprType: ExprType = 'value',
): MethodExpressionNode {
  return { kind: 'method', name, target, args, exprType };
}

export function isPrimitiveValue(value: unknown): value is PrimitiveValue {
  return value === null || ['boolean', 'number', 'string'].includes(typeof value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isExpressionNode(value: unknown): value is ExpressionNode {
  if (!isPlainObject(value)) {
    return false;
  }

  if (value.kind === 'call') {
    return typeof value.name === 'string' && Array.isArray(value.args) && typeof value.exprType === 'string';
  }

  if (value.kind === 'method') {
    return (
      typeof value.name === 'string' &&
      Array.isArray(value.args) &&
      typeof value.exprType === 'string' &&
      'target' in value
    );
  }

  return false;
}

export function isExpressionValue(value: unknown): value is ExpressionValue {
  if (isPrimitiveValue(value) || isExpressionNode(value)) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((entry) => isExpressionValue(entry));
  }

  if (isPlainObject(value)) {
    return Object.values(value).every((entry) => isExpressionValue(entry));
  }

  return false;
}

export function cloneExpressionValue<T extends ExpressionValue>(value: T): T {
  if (isPrimitiveValue(value) || isExpressionNode(value)) {
    return structuredClone(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cloneExpressionValue(entry)) as T;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneExpressionValue(entry)]),
  ) as T;
}

export function normalizeSampleSource(source: SampleSourceSpec | string): SampleSourceSpec {
  return typeof source === 'string' ? { ref: source } : { ref: source.ref };
}

export function normalizeChannelSpec(input: ChannelSpec | ExpressionValue): ChannelSpec {
  if (isPlainObject(input) && 'node' in input && isExpressionValue(input.node)) {
    const channel: ChannelSpec = { node: input.node };
    if (isExpressionValue(input.gain)) {
      channel.gain = input.gain;
    }
    if (typeof input.mute === 'boolean') {
      channel.mute = input.mute;
    }
    if (typeof input.orbit === 'string') {
      channel.orbit = input.orbit;
    }
    return channel;
  }

  return { node: input as ExpressionValue };
}

export function sortObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => {
        if (Array.isArray(entry)) {
          return [
            key,
            entry.map((item) => (isPlainObject(item) ? sortObject(item as Record<string, unknown>) : item)),
          ];
        }

        if (isPlainObject(entry)) {
          return [key, sortObject(entry as Record<string, unknown>)];
        }

        return [key, entry];
      }),
  ) as T;
}

export function stableJson(value: unknown, indent = 2): string {
  return `${JSON.stringify(sortUnknown(value), null, indent)}\n`;
}

function sortUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortUnknown(entry));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortUnknown(entry)]),
    );
  }

  return value;
}

export function renderValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${value}`;
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => renderValue(entry)).join(', ')}]`;
  }

  if (isExpressionNode(value)) {
    if (value.kind === 'call') {
      if (value.exprType === 'signal' && value.args.length === 0 && SIGNAL_IDENTIFIERS.has(value.name)) {
        return value.name;
      }
      return `${value.name}(${value.args.map((entry) => renderValue(entry)).join(', ')})`;
    }

    return `${renderValue(value.target)}.${value.name}(${value.args
      .map((entry) => renderValue(entry))
      .join(', ')})`;
  }

  if (!isPlainObject(value)) {
    throw new TusselValidationError(`Unable to render non-structural value: ${String(value)}`);
  }

  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  if (entries.length === 0) {
    return '{}';
  }

  const renderedEntries = entries
    .map(([key, entry]) => `${isValidIdentifier(key) ? key : JSON.stringify(key)}: ${renderValue(entry)}`)
    .join(', ');

  return `{ ${renderedEntries} }`;
}

function isValidIdentifier(value: string): boolean {
  return /^[$A-Z_][0-9A-Z_$]*$/i.test(value);
}

const SIGNAL_IDENTIFIERS = new Set(['perlin', 'rand', 'saw', 'sine', 'square', 'tri', 'triangle']);

export function collectCustomParamNames(
  value: unknown,
  builtinCalls: ReadonlySet<string>,
  builtinMethods: ReadonlySet<string>,
  names = new Set<string>(),
): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectCustomParamNames(entry, builtinCalls, builtinMethods, names);
    }
    return names;
  }

  if (isExpressionNode(value)) {
    if (value.kind === 'call') {
      if (!builtinCalls.has(value.name)) {
        names.add(value.name);
      }
      for (const entry of value.args) {
        collectCustomParamNames(entry, builtinCalls, builtinMethods, names);
      }
      return names;
    }

    if (!builtinMethods.has(value.name)) {
      names.add(value.name);
    }
    collectCustomParamNames(value.target, builtinCalls, builtinMethods, names);
    for (const entry of value.args) {
      collectCustomParamNames(entry, builtinCalls, builtinMethods, names);
    }
  } else if (isPlainObject(value)) {
    for (const entry of Object.values(value)) {
      collectCustomParamNames(entry, builtinCalls, builtinMethods, names);
    }
  }

  return names;
}

export function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const numeric = Number(value.trim());
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return undefined;
}

export function assertSceneSpec(value: unknown): asserts value is SceneSpec {
  if (!isPlainObject(value)) {
    throw new TusselValidationError('Scene must be an object');
  }

  if (!('transport' in value) || !isPlainObject(value.transport)) {
    throw new TusselValidationError('Scene.transport must be an object');
  }

  if (!('samples' in value) || !Array.isArray(value.samples)) {
    throw new TusselValidationError('Scene.samples must be an array');
  }

  if (!('channels' in value) || !isPlainObject(value.channels)) {
    throw new TusselValidationError('Scene.channels must be an object');
  }

  for (const [channelName, channel] of Object.entries(value.channels)) {
    if (!isPlainObject(channel) || !('node' in channel) || !isExpressionValue(channel.node)) {
      throw new TusselValidationError(`Scene.channels.${channelName} must include a structural node`);
    }
  }
}
