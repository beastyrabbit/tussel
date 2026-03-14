import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderSceneToWavBuffer } from '@tussel/audio';
import {
  type ExpressionValue,
  isExpressionNode,
  isPlainObject,
  type SceneSpec,
  stableJson,
} from '@tussel/ir';
import {
  type ExternalSourceKind,
  type ImportedScene,
  importExternalSource,
  type NativeSourceKind,
  prepareScene,
  prepareSceneFromSource,
  queryPreparedScene,
  type SourceKind,
} from '@tussel/runtime';
import type { ExternalFixtureSource, NormalizedEvent } from '../schema.js';

export async function prepareTusselScene(
  sourceKind: SourceKind,
  source: ExternalFixtureSource,
): Promise<ImportedScene> {
  if (source.path) {
    const absolutePath = path.resolve(source.path);
    return isExternalSourceKind(sourceKind)
      ? importExternalSource(absolutePath, { entry: source.entry })
      : prepareScene(absolutePath, { entry: source.entry });
  }

  if (!source.code) {
    throw new Error(`Missing source text for ${sourceKind}`);
  }

  return prepareSceneFromSource(sourceKind, source.code, {
    entry: source.entry,
    filename: fixtureFilename(sourceKind),
  });
}

export async function queryTusselEvents(
  prepared: ImportedScene,
  options: {
    cps: number;
    durationCycles: number;
  },
): Promise<NormalizedEvent[]> {
  return queryPreparedScene(prepared, 0, options.durationCycles, { cps: options.cps })
    .map((event) => ({
      begin: round(event.begin),
      channel: event.channel,
      duration: round(event.duration),
      end: round(event.end),
      payload: Object.fromEntries(
        Object.entries(event.payload)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, normalizeScalar(value)]),
      ),
    }))
    .sort(
      (left, right) =>
        left.begin - right.begin ||
        left.end - right.end ||
        left.channel.localeCompare(right.channel) ||
        JSON.stringify(left.payload).localeCompare(JSON.stringify(right.payload)),
    );
}

export async function renderTusselAudio(
  prepared: ImportedScene,
  options: {
    cps: number;
    durationCycles: number;
    samplePack?: string;
  },
): Promise<Buffer> {
  const scene = prepared.scene;
  const samplePack = options.samplePack ?? scene.samples[0]?.ref;
  const sceneWithSamples: SceneSpec = samplePack
    ? {
        ...scene,
        samples: scene.samples.length > 0 ? scene.samples : [{ ref: samplePack }],
      }
    : scene;

  if (typeof sceneWithSamples.transport.cps !== 'number') {
    sceneWithSamples.transport = { ...sceneWithSamples.transport, cps: options.cps };
  }

  const seconds = options.durationCycles / options.cps;
  return renderSceneToWavBuffer(sceneWithSamples, { seconds, sampleRate: 48_000 });
}

export async function readCanonicalScene(prepared: ImportedScene): Promise<string> {
  return readFile(prepared.canonicalSceneTsPath, 'utf8');
}

export function renderStableScene(prepared: ImportedScene): string {
  return stableJson(canonicalizeScene(prepared.scene));
}

function fixtureFilename(kind: SourceKind): string {
  switch (kind) {
    case 'hydra-js':
      return `inline-${kind}.hydra.js`;
    case 'scene-json':
      return `inline-${kind}.scene.json`;
    case 'scene-ts':
      return `inline-${kind}.scene.ts`;
    case 'script-ts':
      return `inline-${kind}.script.ts`;
    case 'strudel-js':
      return 'inline.strudel.js';
    case 'strudel-mjs':
      return 'inline.strudel.mjs';
    case 'strudel-ts':
      return 'inline.strudel.ts';
    case 'tidal':
      return 'inline.tidal';
  }
}

function isExternalSourceKind(kind: SourceKind): kind is ExternalSourceKind {
  return kind === 'strudel-js' || kind === 'strudel-mjs' || kind === 'strudel-ts' || kind === 'tidal';
}

function normalizeScalar(value: unknown): boolean | null | number | string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return round(value);
  }
  return `${value}`;
}

function round(value: number): number {
  return Number(value.toFixed(9));
}

export type SupportedFixtureSourceKind = ExternalSourceKind | NativeSourceKind;

const _PROPERTY_METHODS = new Set([
  'attack',
  'bank',
  'begin',
  'clip',
  'cut',
  'decay',
  'delay',
  'end',
  'gain',
  'hpf',
  'lpf',
  'pan',
  'release',
  'room',
  'size',
  'speed',
  'sustain',
]);

function canonicalizeScene(scene: SceneSpec): SceneSpec {
  const channels = Object.fromEntries(
    Object.entries(scene.channels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, channel]) => [
        name,
        {
          ...(channel.gain === undefined ? {} : { gain: canonicalizeValue(channel.gain) }),
          ...(channel.mute === undefined ? {} : { mute: channel.mute }),
          node: canonicalizeValue(channel.node),
          ...(channel.orbit === undefined ? {} : { orbit: channel.orbit }),
        },
      ]),
  );

  const master =
    scene.master && Object.keys(scene.master).length > 0
      ? (canonicalizePlainObject(scene.master as Record<string, unknown>) as SceneSpec['master'])
      : undefined;
  const metadata =
    scene.metadata && Object.keys(scene.metadata).length > 0
      ? (canonicalizePlainObject(scene.metadata as Record<string, unknown>) as SceneSpec['metadata'])
      : undefined;

  return {
    channels,
    ...(master ? { master } : {}),
    ...(metadata ? { metadata } : {}),
    samples: scene.samples.map((sample) => ({ ref: sample.ref })),
    transport: canonicalizePlainObject(scene.transport as Record<string, unknown>) as SceneSpec['transport'],
  };
}

function canonicalizeValue(value: ExpressionValue): ExpressionValue {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeValue(entry));
  }

  if (isExpressionNode(value)) {
    if (value.kind === 'call') {
      return {
        ...value,
        args: value.args.map((entry) => canonicalizeValue(entry)),
      };
    }
    return canonicalizeMethodChain(value);
  }

  if (isPlainObject(value)) {
    return canonicalizePlainObject(value) as ExpressionValue;
  }

  return value;
}

function canonicalizeMethodChain(value: Extract<ExpressionValue, { kind: 'method' }>): ExpressionValue {
  const chain: Array<{ args: ExpressionValue[]; exprType: string; name: string }> = [];
  let current: ExpressionValue = value;

  while (isExpressionNode(current) && current.kind === 'method') {
    chain.unshift({
      args: current.args.map((entry) => canonicalizeValue(entry)),
      exprType: current.exprType,
      name: current.name,
    });
    current = current.target;
  }

  let rebuilt = canonicalizeValue(current);
  for (const method of chain) {
    rebuilt = {
      args: method.args,
      exprType: method.exprType as 'pattern' | 'scene' | 'signal' | 'value',
      kind: 'method',
      name: method.name,
      target: rebuilt,
    };
  }

  return rebuilt;
}

function canonicalizePlainObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeUnknown(entry)]),
  );
}

function canonicalizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeUnknown(entry));
  }
  if (isExpressionNode(value) || isPlainObject(value)) {
    return canonicalizeValue(value as ExpressionValue);
  }
  return value;
}
