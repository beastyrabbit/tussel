export function detectCps(code: string): number {
  const match = /setcps\(\((.+?)\)\s*\/\s*60\)|setcps\((.+?)\)/.exec(code);
  const rawValue = match?.[1] ?? match?.[2];
  if (!rawValue) {
    return 1;
  }
  try {
    // Safely evaluate simple arithmetic from fixture content (e.g. "120/60", "0.5").
    // Only allow digits, whitespace, parens, decimal points, and basic arithmetic.
    if (!/^[\d\s()+\-*/.]+$/.test(rawValue)) {
      return 1;
    }
    const divMatch = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(rawValue);
    if (divMatch) {
      const result = Number(divMatch[1]) / Number(divMatch[2]);
      return Number.isFinite(result) && result > 0 ? result : 1;
    }
    const mulMatch = /^\s*(\d+(?:\.\d+)?)\s*\*\s*(\d+(?:\.\d+)?)\s*$/.exec(rawValue);
    if (mulMatch) {
      const result = Number(mulMatch[1]) * Number(mulMatch[2]);
      return Number.isFinite(result) && result > 0 ? result : 1;
    }
    const result = Number(rawValue);
    return Number.isFinite(result) && result > 0 ? result : 1;
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
