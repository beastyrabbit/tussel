import {
  type ExpressionValue,
  isExpressionNode,
  isPlainObject,
  type MasterSpec,
  renderValue,
  type SceneSpec,
} from '@tussel/ir';

export function renderSceneToStrudelScript(scene: SceneSpec): string {
  return renderSceneToStrudelScriptWithOptions(scene, { includeState: true });
}

export function renderSceneToStrudelScriptWithOptions(
  scene: SceneSpec,
  options: {
    includeState: boolean;
  },
): string {
  const lines: string[] = [];
  const customParams = [...collectCustomParamNames(scene)].sort();

  if (options.includeState) {
    for (const sample of scene.samples) {
      lines.push(`samples(${renderValue(sample.ref)});`);
    }

    if (scene.transport.cps !== undefined) {
      lines.push(`setcps(${renderValue(scene.transport.cps)});`);
    }

    if (scene.transport.bpm !== undefined) {
      lines.push(`setbpm(${renderValue(scene.transport.bpm)});`);
    }
  }

  const customPrelude = renderCustomParamPrelude(customParams);
  if (customPrelude) {
    lines.push(customPrelude);
  }

  lines.push(renderRoot(scene));
  return `${lines.join('\n')}\n`;
}

function renderRoot(scene: SceneSpec): string {
  const channelEntries = Object.entries(scene.channels)
    .sort(([left], [right]) => left.localeCompare(right))
    .filter(([, channel]) => !channel.mute)
    .map(([, channel]) => renderChannel(channel));

  const base =
    channelEntries.length === 0
      ? 'silence()'
      : channelEntries.length === 1
        ? (channelEntries[0] ?? 'silence()')
        : `stack(${channelEntries.join(', ')})`;

  return applyMaster(base, scene.master);
}

function renderChannel(channel: SceneSpec['channels'][string]): string {
  let current = renderExpression(channel.node);
  if (channel.gain !== undefined) {
    current = `(${current}).gain(${renderExpression(channel.gain)})`;
  }
  if (channel.orbit !== undefined) {
    current = `(${current}).orbit(${renderValue(channel.orbit)})`;
  }
  return current;
}

function applyMaster(source: string, master?: MasterSpec): string {
  if (!master) {
    return source;
  }

  let current = source;
  for (const key of ['delay', 'gain', 'room', 'size'] as const) {
    const value = master[key];
    if (value === undefined) {
      continue;
    }
    current = `(${current}).${key}(${renderExpression(value)})`;
  }
  return current;
}

function renderExpression(value: ExpressionValue): string {
  if (!isExpressionNode(value)) {
    if (isPlainObject(value)) {
      return renderPlainObjectPattern(value);
    }
    return renderValue(value);
  }

  if (value.kind === 'call') {
    if (value.name === 'value') {
      return renderExpression(value.args[0] as ExpressionValue);
    }
    if (value.args.length === 0 && ZERO_ARG_IDENTIFIERS.has(value.name)) {
      return value.name;
    }
    return `${value.name}(${value.args.map((entry) => renderExpression(entry)).join(', ')})`;
  }

  const renderedTarget = renderExpression(value.target);
  const renderedArgs = value.args.map((entry) => renderExpression(entry)).join(', ');
  return `${renderedTarget}.${value.name}(${renderedArgs})`;
}

function renderPlainObjectPattern(value: Record<string, unknown>): string {
  const entries = Object.entries(value);
  const baseEntry =
    entries.find(([key]) => key === 's' || key === 'sound') ??
    entries.find(([key]) => key === 'note') ??
    entries.find(([key]) => key === 'chord') ??
    entries.find(([key]) => key === 'n') ??
    entries.find(([key]) => key === 'value');

  if (!baseEntry) {
    return renderValue(value);
  }

  const [baseKey, baseValue] = baseEntry;
  let current = renderBasePattern(baseKey, baseValue as ExpressionValue);
  for (const [key, entry] of entries) {
    if (key === baseKey) {
      continue;
    }
    current = `(${current}).${normalizeObjectMethodName(key)}(${renderExpression(entry as ExpressionValue)})`;
  }
  return current;
}

function renderBasePattern(key: string, value: ExpressionValue): string {
  if (key === 's' || key === 'sound') {
    return `s(${renderExpression(value)})`;
  }
  return `${key}(${renderExpression(value)})`;
}

function normalizeObjectMethodName(key: string): string {
  return key === 'sound' ? 's' : key;
}

const BUILTIN_CALLS = new Set([
  'cat',
  'chord',
  'contract',
  'cosine',
  'drop',
  'expand',
  'extend',
  'grow',
  'n',
  'note',
  'pace',
  'perlin',
  'ply',
  'rand',
  's',
  'saw',
  'seq',
  'silence',
  'sine',
  'slow',
  'sound',
  'square',
  'stack',
  'stepalt',
  'stepcat',
  'take',
  'tri',
  'triangle',
  'value',
  'zip',
]);

const BUILTIN_METHODS = new Set([
  'add',
  'anchor',
  'attack',
  'bank',
  'begin',
  'ceil',
  'chunk',
  'clip',
  'compress',
  'contract',
  'color',
  'cut',
  'cutoff',
  'decay',
  'delay',
  'dict',
  'div',
  'drop',
  'early',
  'end',
  'expand',
  'extend',
  'fast',
  'fastGap',
  'floor',
  'fm',
  'gain',
  'hcutoff',
  'hpf',
  'hurry',
  'late',
  'linger',
  'log',
  'loop',
  'lpf',
  'lpq',
  'mask',
  'mode',
  'mul',
  'note',
  'offset',
  'orbit',
  'pace',
  'pan',
  'phaser',
  'ply',
  'punchcard',
  'range',
  'rarely',
  'rev',
  'rootNotes',
  'room',
  'round',
  's',
  'scramble',
  'scale',
  'scaleTranspose',
  'segment',
  'set',
  'shape',
  'shuffle',
  'shrink',
  'size',
  'slow',
  'slowGap',
  'sound',
  'speed',
  'struct',
  'sub',
  'sustain',
  'take',
  'tour',
  'transpose',
  'voicing',
  'voicings',
  'zoom',
  '_punchcard',
  '_scope',
]);

const ZERO_ARG_IDENTIFIERS = new Set([
  'cosine',
  'perlin',
  'rand',
  'saw',
  'sine',
  'square',
  'tri',
  'triangle',
]);

function renderCustomParamPrelude(names: string[]): string | undefined {
  if (names.length === 0) {
    return undefined;
  }
  if (names.length === 1) {
    const [first] = names;
    if (!first) {
      return undefined;
    }
    return `const ${first} = createParam(${renderSingleQuotedString(first)});`;
  }
  return `const { ${names.join(', ')} } = createParams(${names.map((name) => renderSingleQuotedString(name)).join(', ')});`;
}

function renderSingleQuotedString(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function collectCustomParamNames(value: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectCustomParamNames(entry, names);
    }
    return names;
  }

  if (isExpressionNode(value)) {
    if (value.kind === 'call') {
      if (!BUILTIN_CALLS.has(value.name)) {
        names.add(value.name);
      }
      for (const entry of value.args) {
        collectCustomParamNames(entry, names);
      }
      return names;
    }

    if (!BUILTIN_METHODS.has(value.name)) {
      names.add(value.name);
    }
    collectCustomParamNames(value.target, names);
    for (const entry of value.args) {
      collectCustomParamNames(entry, names);
    }
    return names;
  }

  if (isPlainObject(value)) {
    for (const entry of Object.values(value)) {
      collectCustomParamNames(entry, names);
    }
  }

  return names;
}
