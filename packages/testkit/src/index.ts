import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function createFixtureDirectory(prefix = 'tussel-fixture-'): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function writeFixtureFile(
  rootDir: string,
  relativePath: string,
  contents: string,
): Promise<string> {
  const target = path.join(rootDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
  return target;
}

export function extractMarkdownLinks(markdown: string): string[] {
  return [...markdown.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}
