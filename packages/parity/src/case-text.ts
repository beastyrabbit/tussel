export function detectCps(code: string): number {
  const match = /setcps\(\((.+?)\)\s*\/\s*60\)|setcps\((.+?)\)/.exec(code);
  const rawValue = match?.[1] ?? match?.[2];
  if (!rawValue) {
    return 1;
  }
  try {
    // This only evaluates trusted local fixture and docs content.
    const value = Function(`return (${rawValue});`)() as number;
    return Number.isFinite(value) && value > 0 ? value : 1;
  } catch {
    return 1;
  }
}

export function describeSnippet(text: string, offset: number, index: number, fallbackPrefix: string): string {
  const lines = text.slice(0, offset).split('\n');
  for (let cursor = lines.length - 1; cursor >= 0; cursor -= 1) {
    const line = (lines[cursor] ?? '').trim();
    if (line.startsWith('#')) {
      return line.replace(/^#+\s*/, '');
    }
    const boldMatch = /^\*\*(.+)\*\*$/.exec(line);
    if (boldMatch?.[1]) {
      return boldMatch[1];
    }
  }
  return `${fallbackPrefix} ${index}`;
}
