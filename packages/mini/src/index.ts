import { TusselParseError } from '@tussel/ir';

export interface MiniEvent {
  begin: number;
  end: number;
  value: string;
}

type MiniNode =
  | { factor: number; kind: 'group'; items: MiniNode[]; stepSource?: boolean }
  | { factor: number; kind: 'literal'; value: string }
  | { factor: number; kind: 'repeat'; count: number; node: MiniNode }
  | { factor: number; kind: 'rest' }
  | { factor: number; kind: 'seq'; items: MiniNode[] }
  | { factor: number; kind: 'slowcat'; items: MiniNode[]; stepSource?: boolean }
  | { factor: number; kind: 'stack'; items: MiniNode[] }
  | { factor: number; kind: 'stretch'; node: MiniNode };

class Parser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): MiniNode {
    const items = this.parseList('');
    return { kind: 'seq', items, factor: 1 };
  }

  private parseList(terminator: string): MiniNode[] {
    const items: MiniNode[] = [];
    let closed = false;

    while (!this.eof()) {
      this.skipWhitespace();
      if (terminator && this.peek() === terminator) {
        this.index += 1;
        closed = true;
        break;
      }

      if (!terminator && this.eof()) {
        break;
      }

      const node = this.parseStackItem(terminator);
      if (node) {
        items.push(node);
      }

      this.skipWhitespace();
      if (!terminator && this.eof()) {
        break;
      }
    }

    if (terminator && !closed) {
      throw new TusselParseError(`Unterminated ${terminator === ']' ? '[' : '<'} group in mini source`);
    }

    return items;
  }

  private parseStackItem(terminator: string): MiniNode | undefined {
    const items: MiniNode[] = [];
    let current = this.parseItem(terminator);
    if (!current) {
      return undefined;
    }
    items.push(current);

    while (true) {
      this.skipWhitespace();
      if (this.peek() !== ',') {
        break;
      }
      this.index += 1;
      this.skipWhitespace();
      current = this.parseItem(terminator);
      if (!current) {
        break;
      }
      items.push(current);
    }

    if (items.length === 1) {
      return items[0];
    }

    return { kind: 'stack', items, factor: 1 };
  }

  private parseItem(terminator: string): MiniNode | undefined {
    this.skipWhitespace();
    if (this.eof()) {
      return undefined;
    }

    const next = this.peek();
    if (!next || (terminator && next === terminator)) {
      return undefined;
    }

    let node: MiniNode;
    if (next === '[') {
      this.index += 1;
      const stepSource = this.peek() === '^';
      if (stepSource) {
        this.index += 1;
      }
      node = { kind: 'group', items: this.parseList(']'), factor: 1, stepSource };
    } else if (next === '<') {
      this.index += 1;
      const stepSource = this.peek() === '^';
      if (stepSource) {
        this.index += 1;
      }
      node = { kind: 'slowcat', items: this.parseList('>'), factor: 1, stepSource };
    } else if (next === '~' || next === '-') {
      this.index += 1;
      node = { kind: 'rest', factor: 1 };
    } else {
      node = { kind: 'literal', value: this.readToken(), factor: 1 };
    }

    return this.parsePostfix(node);
  }

  private parsePostfix(node: MiniNode): MiniNode {
    while (!this.eof()) {
      const next = this.peek();
      if (next === '*' || next === '!' || next === '@') {
        this.index += 1;
        const count = this.readNumber();
        node =
          next === '@'
            ? {
                kind: 'stretch',
                factor: node.factor * count,
                node,
              }
            : {
                kind: 'repeat',
                count,
                factor: next === '*' ? node.factor : node.factor * count,
                node,
              };
        continue;
      }

      if (next === '/') {
        this.index += 1;
        const factor = this.readNumber();
        node = { ...node, factor: node.factor * factor };
        continue;
      }

      break;
    }

    return node;
  }

  private readNumber(): number {
    const start = this.index;
    while (!this.eof() && /[0-9.]/.test(this.peek() ?? '')) {
      this.index += 1;
    }
    const raw = this.source.slice(start, this.index);
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new TusselParseError(`Invalid mini numeric postfix "${raw}"`);
    }
    return value;
  }

  private readToken(): string {
    const start = this.index;
    while (!this.eof()) {
      const next = this.peek();
      if (!next || /[\s,[\]<>*/!@]/.test(next)) {
        break;
      }
      this.index += 1;
    }

    const token = this.source.slice(start, this.index);
    if (!token) {
      throw new TusselParseError(`Unexpected token in mini source "${this.source}"`);
    }
    return token;
  }

  private skipWhitespace(): void {
    while (!this.eof() && /\s/.test(this.peek() ?? '')) {
      this.index += 1;
    }
  }

  private peek(): string | undefined {
    return this.source[this.index];
  }

  private eof(): boolean {
    return this.index >= this.source.length;
  }
}

export function parseMini(source: string): MiniNode {
  return new Parser(preprocessMini(source)).parse();
}

export function inferMiniSteps(source: string): number {
  const root = parseMini(source);
  const markedStepUnit = inferMarkedStepUnit(root, 1, false);
  if (markedStepUnit !== undefined && markedStepUnit > 0) {
    return Number((1 / markedStepUnit).toFixed(12));
  }
  return countSteps(root);
}

export function queryMini(source: string, beginCycle: number, endCycle: number): MiniEvent[] {
  const root = parseMini(source);
  const firstCycle = Math.floor(beginCycle);
  const lastCycle = Math.max(firstCycle + 1, Math.ceil(endCycle));
  const events: MiniEvent[] = [];

  for (let cycle = firstCycle; cycle < lastCycle; cycle += 1) {
    events.push(...renderNode(root, beginCycle, endCycle, cycle, cycle + 1));
  }

  return events.sort((left, right) => left.begin - right.begin || left.value.localeCompare(right.value));
}

function renderNode(
  node: MiniNode,
  beginCycle: number,
  endCycle: number,
  spanBegin: number,
  spanEnd: number,
): MiniEvent[] {
  if (spanEnd <= beginCycle || spanBegin >= endCycle) {
    return [];
  }

  switch (node.kind) {
    case 'literal':
      return [{ begin: spanBegin, end: spanEnd, value: node.value }];
    case 'rest':
      return [];
    case 'stack':
      return node.items.flatMap((entry) => renderNode(entry, beginCycle, endCycle, spanBegin, spanEnd));
    case 'repeat': {
      const events: MiniEvent[] = [];
      const width = (spanEnd - spanBegin) / node.count;
      for (let index = 0; index < node.count; index += 1) {
        const childBegin = spanBegin + width * index;
        events.push(...renderNode(node.node, beginCycle, endCycle, childBegin, childBegin + width));
      }
      return events;
    }
    case 'stretch':
      return renderNode(node.node, beginCycle, endCycle, spanBegin, spanEnd);
    case 'group':
    case 'seq': {
      const totalFactor = node.items.reduce((sum, entry) => sum + entry.factor, 0) || 1;
      let cursor = spanBegin;
      const events: MiniEvent[] = [];
      for (const item of node.items) {
        const width = ((spanEnd - spanBegin) * item.factor) / totalFactor;
        events.push(...renderNode(stripFactor(item), beginCycle, endCycle, cursor, cursor + width));
        cursor += width;
      }
      return events;
    }
    case 'slowcat': {
      const events: MiniEvent[] = [];
      const firstCycle = Math.floor(spanBegin);
      const lastCycle = Math.ceil(spanEnd);
      for (let cycle = firstCycle; cycle < lastCycle; cycle += 1) {
        const slotIndex = mod(cycle, node.items.length || 1);
        const item = node.items[slotIndex];
        if (!item) {
          continue;
        }
        const segmentBegin = Math.max(spanBegin, cycle);
        const segmentEnd = Math.min(spanEnd, cycle + 1);
        events.push(...renderNode(stripFactor(item), beginCycle, endCycle, segmentBegin, segmentEnd));
      }
      return events;
    }
  }
}

function countSteps(node: MiniNode): number {
  switch (node.kind) {
    case 'literal':
    case 'rest':
    case 'stack':
      return node.factor;
    case 'repeat':
    case 'stretch':
      return node.factor;
    case 'group':
    case 'seq':
      return node.items.reduce((sum, entry) => sum + entry.factor, 0);
    case 'slowcat':
      return node.items.length;
  }
}

function inferMarkedStepUnit(node: MiniNode, span: number, inheritedMark: boolean): number | undefined {
  const isMarked = inheritedMark || ('stepSource' in node && node.stepSource === true);

  switch (node.kind) {
    case 'literal':
    case 'rest':
    case 'repeat':
    case 'stretch':
      return isMarked ? span / node.factor : undefined;
    case 'stack':
      return minDefined(node.items.map((entry) => inferMarkedStepUnit(entry, span, isMarked)));
    case 'group':
    case 'seq':
      return inferMarkedSequenceUnit(node.items, span, isMarked);
    case 'slowcat': {
      const itemSpan = span / Math.max(node.items.length, 1);
      return inferMarkedSequenceUnit(node.items, span, isMarked, itemSpan);
    }
  }
}

function inferMarkedSequenceUnit(
  items: MiniNode[],
  span: number,
  isMarked: boolean,
  fixedSpan?: number,
): number | undefined {
  const totalFactor = fixedSpan === undefined ? items.reduce((sum, entry) => sum + entry.factor, 0) || 1 : 1;
  const candidates: number[] = [];

  for (const item of items) {
    const itemSpan = fixedSpan ?? (span * item.factor) / totalFactor;
    if (isMarked) {
      candidates.push(itemSpan / item.factor);
    }
    const nested = inferMarkedStepUnit(item, itemSpan, false);
    if (nested !== undefined) {
      candidates.push(nested);
    }
  }

  return minDefined(candidates);
}

function minDefined(values: Array<number | undefined>): number | undefined {
  const filtered = values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value) && value > 0,
  );
  if (filtered.length === 0) {
    return undefined;
  }
  return Math.min(...filtered);
}

function stripFactor(node: MiniNode): MiniNode {
  if (node.factor === 1) {
    return node;
  }
  return { ...node, factor: 1 };
}

function mod(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

export function showFirstCycle(source: string): string[] {
  return queryMini(source, 0, 1)
    .map((event) => `${event.value}: ${formatNumber(event.begin)} - ${formatNumber(event.end)}`)
    .sort();
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return `${value}`;
  }
  return Number(value.toFixed(6)).toString();
}

function preprocessMini(source: string): string {
  let result = '';
  let index = 0;

  while (index < source.length) {
    const prefixMatch = /^([A-Za-z0-9_$.-]+):(?=[<[>])/.exec(source.slice(index));
    if (!prefixMatch?.[1]) {
      result += source[index] ?? '';
      index += 1;
      continue;
    }

    const prefix = prefixMatch[1];
    const groupStart = index + prefix.length + 1;
    const opener = source[groupStart];
    if (opener !== '<' && opener !== '[') {
      result += source[index] ?? '';
      index += 1;
      continue;
    }

    const { content, endIndex } = consumeGroup(source, groupStart);
    result += `${opener}${prefixGroupContent(prefix, content)}${matchingCloser(opener)}`;
    index = endIndex;
  }

  return expandNumericEuclid(result);
}

function expandNumericEuclid(source: string): string {
  return source.replace(
    /(^|[\s,[<])([^,\s[\]<>*/!@()]+)\(\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(-?\d+))?\s*\)/g,
    (match, prefix, token, pulsesRaw, stepsRaw, rotationRaw) => {
      const pulses = Number(pulsesRaw);
      const steps = Number(stepsRaw);
      const rotation = rotationRaw === undefined ? 0 : Number(rotationRaw);
      if (
        !Number.isInteger(pulses) ||
        !Number.isInteger(steps) ||
        !Number.isInteger(rotation) ||
        pulses <= 0 ||
        steps <= 0 ||
        pulses > steps
      ) {
        return match;
      }
      const pattern = buildEuclideanSequence(token, pulses, steps, rotation);
      return `${prefix}[${pattern}]`;
    },
  );
}

function buildEuclideanSequence(token: string, pulses: number, steps: number, rotation = 0): string {
  return rotatePattern(buildBjorklundPattern(pulses, steps), rotation)
    .map((active) => (active ? token : '~'))
    .join(' ');
}

function buildBjorklundPattern(pulses: number, steps: number): boolean[] {
  const pattern: number[] = [];
  const counts: number[] = [];
  const remainders = [pulses];
  let divisor = steps - pulses;
  let level = 0;

  while (true) {
    const current = remainders[level];
    if (current === undefined) {
      break;
    }
    counts.push(Math.floor(divisor / current));
    remainders.push(divisor % current);
    divisor = current;
    level += 1;
    const next = remainders[level];
    if (next === undefined || next <= 1) {
      break;
    }
  }
  counts.push(divisor);

  const build = (depth: number): void => {
    if (depth === -1) {
      pattern.push(0);
      return;
    }
    if (depth === -2) {
      pattern.push(1);
      return;
    }
    const count = counts[depth] ?? 0;
    for (let index = 0; index < count; index += 1) {
      build(depth - 1);
    }
    if ((remainders[depth] ?? 0) !== 0) {
      build(depth - 2);
    }
  };

  build(level);

  const firstPulse = pattern.indexOf(1);
  const normalized =
    firstPulse <= 0 ? pattern : [...pattern.slice(firstPulse), ...pattern.slice(0, firstPulse)];
  return normalized.map((entry) => entry === 1);
}

function rotatePattern<T>(values: T[], amount: number): T[] {
  if (values.length === 0 || amount === 0) {
    return values;
  }
  const offset = mod(amount, values.length);
  if (offset === 0) {
    return values;
  }
  return [...values.slice(-offset), ...values.slice(0, -offset)];
}

function prefixGroupContent(prefix: string, content: string): string {
  let result = '';
  let index = 0;

  while (index < content.length) {
    const next = content[index];
    if (!next) {
      break;
    }

    if (next === '[' || next === '<') {
      const { content: nested, endIndex } = consumeGroup(content, index);
      result += `${next}${prefixGroupContent(prefix, nested)}${matchingCloser(next)}`;
      index = endIndex;
      continue;
    }

    if (/[A-Za-z0-9~_-]/.test(next)) {
      const start = index;
      while (index < content.length && /[^,\s<[>]/.test(content[index] ?? '')) {
        index += 1;
      }
      const token = content.slice(start, index);
      result += shouldPrefixToken(token) ? `${prefix}:${token}` : token;
      continue;
    }

    result += next;
    index += 1;
  }

  return result;
}

function consumeGroup(source: string, openIndex: number): { content: string; endIndex: number } {
  const opener = source[openIndex];
  if (opener !== '[' && opener !== '<') {
    throw new TusselParseError(`Expected group opener at ${openIndex}`);
  }

  const closer = matchingCloser(opener);
  let depth = 0;
  let cursor = openIndex;
  while (cursor < source.length) {
    const next = source[cursor];
    if (next === opener) {
      depth += 1;
    } else if (next === closer) {
      depth -= 1;
      if (depth === 0) {
        return {
          content: source.slice(openIndex + 1, cursor),
          endIndex: cursor + 1,
        };
      }
    }
    cursor += 1;
  }

  throw new TusselParseError(`Unterminated ${opener} group in mini source`);
}

function matchingCloser(opener: '<' | '['): '>' | ']' {
  return opener === '<' ? '>' : ']';
}

function shouldPrefixToken(token: string): boolean {
  return !['', '-', '~'].includes(token) && !token.includes(':');
}

export type { MondoEvent } from './mondo.js';
export { isMondoNotation, parseMondo, queryMondo, showMondoFirstCycle } from './mondo.js';
