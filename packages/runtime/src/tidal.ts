interface ParsedTidalProgram {
  bindings: Map<string, string>;
  channels: Array<{ channel: string; expr: string }>;
  rootExpr?: string;
  transport: {
    bpm?: number;
    cps?: number;
  };
}

const CHANNEL_LINE = /^(d[1-9]\d*)\s*\$\s*(.+)$/;
const BINDING_LINE = /^([a-zA-Z_]\w*)\s*=\s*(.+)$/;
const SET_CPS_LINE = /^setcps\s+(.+)$/i;
const SET_BPM_LINE = /^setbpm\s+(.+)$/i;
const SET_CPM_LINE = /^setcpm\s+(.+)$/i;

const BASE_CALLS = new Set(['n', 'note', 's', 'sound']);
const METHOD_NAMES = new Set([
  'attack',
  'bank',
  'begin',
  'clip',
  'cut',
  'decay',
  'delay',
  'early',
  'end',
  'fast',
  'gain',
  'hpf',
  'late',
  'lpf',
  'mask',
  'pan',
  'release',
  'rev',
  'room',
  'size',
  'slow',
  'speed',
  'struct',
  'sustain',
]);

export function translateTidalToSceneModule(source: string, options: { entry?: string } = {}): string {
  const program = translateTidalToStrudelProgram(source, options);
  return [
    `import { defineScene, n, s } from '@tussel/dsl';`,
    '',
    'export default defineScene({',
    '  transport: {',
    program.transport.cps !== undefined ? `    cps: ${program.transport.cps},\n` : '',
    program.transport.bpm !== undefined ? `    bpm: ${program.transport.bpm},\n` : '',
    '  },',
    '  samples: [],',
    '  channels: {',
    program.channels
      .map(({ channel, expr }) => `    ${JSON.stringify(channel)}: { node: ${expr} },`)
      .join('\n'),
    '  },',
    '});',
    '',
  ].join('\n');
}

export function translateTidalToStrudelProgram(
  source: string,
  options: { entry?: string } = {},
): {
  channels: Array<{ channel: string; expr: string }>;
  transport: {
    bpm?: number;
    cps?: number;
  };
} {
  const program = parseProgram(source);
  const channels = resolveChannels(program, options.entry);
  return {
    channels: channels.map(({ channel, expr }) => ({ channel, expr: translateExpr(expr, program.bindings) })),
    transport: program.transport,
  };
}

function parseProgram(source: string): ParsedTidalProgram {
  const bindings = new Map<string, string>();
  const channels: Array<{ channel: string; expr: string }> = [];
  let rootExpr: string | undefined;
  let bpm: number | undefined;
  let cps: number | undefined;

  for (const rawLine of source.split('\n')) {
    const line = stripComment(rawLine).trim();
    if (!line) {
      continue;
    }

    const setCps = SET_CPS_LINE.exec(line);
    if (setCps?.[1]) {
      cps = parseNumericLiteral(setCps[1], 'setcps');
      continue;
    }

    const setBpm = SET_BPM_LINE.exec(line) ?? SET_CPM_LINE.exec(line);
    if (setBpm?.[1]) {
      bpm = parseNumericLiteral(setBpm[1], 'setbpm');
      continue;
    }

    const channel = CHANNEL_LINE.exec(line);
    if (channel?.[1] && channel[2]) {
      channels.push({ channel: channel[1], expr: channel[2].trim() });
      continue;
    }

    const binding = BINDING_LINE.exec(line);
    if (binding?.[1] && binding[2]) {
      bindings.set(binding[1], binding[2].trim());
      continue;
    }

    rootExpr = line;
  }

  return {
    bindings,
    channels,
    rootExpr,
    transport: { bpm, cps },
  };
}

function resolveChannels(
  program: ParsedTidalProgram,
  entry?: string,
): Array<{ channel: string; expr: string }> {
  if (program.channels.length > 0) {
    return program.channels;
  }

  if (entry) {
    const binding = program.bindings.get(entry);
    if (binding) {
      return [{ channel: entry, expr: binding }];
    }
    throw new Error(
      `Unable to resolve tidal entry "${entry}". Available bindings: ${[...program.bindings.keys()].join(', ')}`,
    );
  }

  if (program.rootExpr) {
    return [{ channel: 'd1', expr: program.rootExpr }];
  }

  if (program.bindings.size === 1) {
    const [name, expr] = [...program.bindings.entries()][0] ?? [];
    if (name && expr) {
      return [{ channel: name, expr }];
    }
  }

  if (program.bindings.size > 1) {
    throw new Error('Ambiguous tidal source. Pass --entry <binding-or-root> to select a binding.');
  }

  throw new Error('Tidal source did not contain a runnable root.');
}

function translateExpr(expr: string, bindings: Map<string, string>): string {
  const trimmed = trimOuter(expr);
  if (!trimmed) {
    throw new Error('Empty tidal expression');
  }

  const dollarIndex = findTopLevelOperator(trimmed, '$');
  if (dollarIndex !== -1) {
    const left = trimOuter(trimmed.slice(0, dollarIndex));
    const right = trimOuter(trimmed.slice(dollarIndex + 1));
    return applyPrefix(left, translateExpr(right, bindings), bindings);
  }

  const hashParts = splitTopLevel(trimmed, '#');
  let current = translateAtom(hashParts[0] ?? '', bindings);
  for (const part of hashParts.slice(1)) {
    current = applyControl(current, part, bindings);
  }
  return current;
}

function translateAtom(expr: string, bindings: Map<string, string>): string {
  const trimmed = trimOuter(expr);
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {
    throw new Error(`Unsupported tidal expression: ${expr}`);
  }

  if (tokens.length === 1) {
    const [single] = tokens;
    if (single && bindings.has(single)) {
      return translateExpr(bindings.get(single) ?? '', bindings);
    }
  }

  const [head, ...rest] = tokens;
  if (head && BASE_CALLS.has(head)) {
    const callee = head === 'sound' ? 's' : head === 'note' ? 'n' : head;
    const argument = rest.join(' ').trim();
    if (!argument) {
      throw new Error(`Missing tidal argument for ${head}`);
    }
    return `${callee}(${translateArgument(argument, bindings)})`;
  }

  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return `(${translateExpr(trimmed.slice(1, -1), bindings)})`;
  }

  throw new Error(`Unsupported tidal atom: ${expr}`);
}

function applyPrefix(prefix: string, target: string, bindings: Map<string, string>): string {
  const tokens = tokenize(prefix);
  if (tokens.length === 0) {
    return target;
  }
  const [head, ...rest] = tokens;
  if (!head || !METHOD_NAMES.has(head)) {
    throw new Error(`Unsupported tidal transform: ${prefix}`);
  }
  if (head === 'rev') {
    return `${target}.rev()`;
  }
  const argument = rest.join(' ').trim();
  if (!argument) {
    throw new Error(`Missing tidal argument for ${head}`);
  }
  return `${target}.${head}(${translateArgument(argument, bindings)})`;
}

function applyControl(target: string, control: string, bindings: Map<string, string>): string {
  const tokens = tokenize(control);
  const [head, ...rest] = tokens;
  if (!head) {
    throw new Error(`Unsupported tidal control: ${control}`);
  }
  if (BASE_CALLS.has(head)) {
    const argument = rest.join(' ').trim();
    if (!argument) {
      throw new Error(`Missing tidal control value for ${head}`);
    }
    if (head === 'sound' || head === 's') {
      return `${target}.s(${translateArgument(argument, bindings)})`;
    }
    return `${target}.note(${translateArgument(argument, bindings)})`;
  }
  if (!METHOD_NAMES.has(head)) {
    throw new Error(`Unsupported tidal control: ${control}`);
  }
  if (head === 'rev') {
    return `${target}.rev()`;
  }
  const argument = rest.join(' ').trim();
  if (!argument) {
    throw new Error(`Missing tidal control value for ${head}`);
  }
  return `${target}.${head}(${translateArgument(argument, bindings)})`;
}

function translateArgument(argument: string, bindings: Map<string, string>): string {
  const trimmed = trimOuter(argument);
  if (!trimmed) {
    throw new Error('Missing tidal argument');
  }
  if (isQuoted(trimmed)) {
    return JSON.stringify(unquote(trimmed));
  }
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return translateExpr(trimmed.slice(1, -1), bindings);
  }
  if (bindings.has(trimmed)) {
    return translateExpr(bindings.get(trimmed) ?? '', bindings);
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }
  throw new Error(`Unsupported tidal argument: ${argument}`);
}

function parseNumericLiteral(value: string, context: string): number {
  const numeric = Number(value.trim());
  if (!Number.isFinite(numeric)) {
    throw new Error(`Expected numeric literal for ${context}, received ${value}`);
  }
  return numeric;
}

function stripComment(line: string): string {
  const tidalIndex = line.indexOf('--');
  const jsIndex = line.indexOf('//');
  const indexes = [tidalIndex, jsIndex].filter((value) => value >= 0);
  if (indexes.length === 0) {
    return line;
  }
  return line.slice(0, Math.min(...indexes));
}

function trimOuter(value: string): string {
  let current = value.trim();
  while (current.startsWith('(') && current.endsWith(')') && enclosesWholeExpression(current)) {
    current = current.slice(1, -1).trim();
  }
  return current;
}

function enclosesWholeExpression(value: string): boolean {
  let depth = 0;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0 && index < value.length - 1) {
        return false;
      }
    }
  }
  return depth === 0;
}

function findTopLevelOperator(value: string, operator: string): number {
  let depth = 0;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      continue;
    }
    if (depth === 0 && char === operator) {
      return index;
    }
  }
  return -1;
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | undefined;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      continue;
    }
    if (depth === 0 && char === separator) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function tokenize(value: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? '';
    if (quote) {
      current += char;
      if (char === quote && value[index - 1] !== '\\') {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      current += char;
      continue;
    }
    if (depth === 0 && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function isQuoted(value: string): boolean {
  return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
}

function unquote(value: string): string {
  return value.slice(1, -1);
}
