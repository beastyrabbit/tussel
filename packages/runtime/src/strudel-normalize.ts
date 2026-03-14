const TOP_LEVEL_STATE_PREFIXES = ['samples(', 'setbpm(', 'setcpm(', 'setcps('] as const;

export function normalizeStrudelSource(source: string): string {
  let normalized = rewriteSetcpmCalls(source);
  normalized = rewriteLayeredScript(normalized);
  return normalized.trim();
}

function rewriteSetcpmCalls(source: string): string {
  let result = '';
  let index = 0;

  while (index < source.length) {
    const matchIndex = source.indexOf('setcpm(', index);
    if (matchIndex === -1) {
      result += source.slice(index);
      break;
    }

    const previous = source[matchIndex - 1];
    if (previous && /[A-Za-z0-9_$]/.test(previous)) {
      result += source.slice(index, matchIndex + 'setcpm'.length);
      index = matchIndex + 'setcpm'.length;
      continue;
    }

    result += source.slice(index, matchIndex);
    const openParenIndex = matchIndex + 'setcpm'.length;
    const endIndex = findCallEnd(source, openParenIndex);
    if (endIndex === -1) {
      result += source.slice(matchIndex);
      break;
    }

    const argument = source.slice(openParenIndex + 1, endIndex).trim();
    result += `setcps((${argument}) / 60)`;
    index = endIndex + 1;
  }

  return result;
}

function rewriteLayeredScript(source: string): string {
  const lines = source.split('\n');
  const preserved: string[] = [];
  const layers: string[] = [];
  let currentLayer: string[] | undefined;
  let muted = false;

  const flushLayer = () => {
    if (!currentLayer) {
      return;
    }
    const joined = currentLayer.join('\n').trim();
    if (!muted && joined) {
      layers.push(joined);
    }
    currentLayer = undefined;
    muted = false;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('$:') || trimmed.startsWith('_$:')) {
      flushLayer();
      muted = trimmed.startsWith('_$:');
      currentLayer = [line.replace(/^(\s*)_?\$:\s?/, '$1')];
      continue;
    }

    if (currentLayer) {
      if (trimmed === '') {
        currentLayer.push(line);
        continue;
      }

      if (isLayerContinuation(line, trimmed)) {
        currentLayer.push(line);
        continue;
      }

      flushLayer();
    }

    preserved.push(line);
  }

  flushLayer();

  if (layers.length === 0) {
    return source;
  }

  const output = trimTrailingBlankLines(preserved);
  if (output.length > 0 && output[output.length - 1]?.trim() !== '') {
    output.push('');
  }
  output.push('stack(');
  output.push(
    ...layers.map((layer, index) => `${indentBlock(layer, '  ')}${index < layers.length - 1 ? ',' : ''}`),
  );
  output.push(')');
  return output.join('\n');
}

function isLayerContinuation(line: string, trimmed: string): boolean {
  if (line.startsWith(' ') || line.startsWith('\t')) {
    return true;
  }

  if (trimmed.startsWith('.')) {
    return true;
  }

  if (trimmed.startsWith('//')) {
    return true;
  }

  return !TOP_LEVEL_STATE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function indentBlock(value: string, prefix: string): string {
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed.at(-1)?.trim() === '') {
    trimmed.pop();
  }
  return trimmed;
}

function findCallEnd(source: string, openParenIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | undefined;

  for (let index = openParenIndex; index < source.length; index += 1) {
    const char = source[index];
    if (!char) {
      continue;
    }

    if (quote) {
      if (char === quote && source[index - 1] !== '\\') {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}
