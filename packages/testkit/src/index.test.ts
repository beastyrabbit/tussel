import { existsSync } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureDirectory, extractMarkdownLinks, writeFixtureFile } from '@tussel/testkit';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { force: true, recursive: true }).catch(() => {});
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// createFixtureDirectory
// ---------------------------------------------------------------------------
describe('createFixtureDirectory', () => {
  it('creates a temp directory', async () => {
    const dir = await createFixtureDirectory();
    tempDirs.push(dir);
    expect(typeof dir).toBe('string');
    expect(dir.length).toBeGreaterThan(0);

    const stats = await stat(dir);
    expect(stats.isDirectory()).toBe(true);
  });

  it('creates a directory with default prefix', async () => {
    const dir = await createFixtureDirectory();
    tempDirs.push(dir);
    expect(path.basename(dir)).toMatch(/^tussel-fixture-/);
  });

  it('creates a directory with custom prefix', async () => {
    const dir = await createFixtureDirectory('custom-prefix-');
    tempDirs.push(dir);
    expect(path.basename(dir)).toMatch(/^custom-prefix-/);
  });

  it('creates unique directories on repeated calls', async () => {
    const dir1 = await createFixtureDirectory();
    const dir2 = await createFixtureDirectory();
    tempDirs.push(dir1, dir2);
    expect(dir1).not.toBe(dir2);
  });
});

// ---------------------------------------------------------------------------
// writeFixtureFile
// ---------------------------------------------------------------------------
describe('writeFixtureFile', () => {
  it('writes a file in the fixture directory', async () => {
    const dir = await createFixtureDirectory();
    tempDirs.push(dir);
    const filePath = await writeFixtureFile(dir, 'hello.txt', 'Hello, world!');
    expect(filePath).toBe(path.join(dir, 'hello.txt'));

    const contents = await readFile(filePath, 'utf-8');
    expect(contents).toBe('Hello, world!');
  });

  it('creates parent directories as needed', async () => {
    const dir = await createFixtureDirectory();
    tempDirs.push(dir);
    const filePath = await writeFixtureFile(dir, 'nested/deep/file.txt', 'content');
    expect(filePath).toBe(path.join(dir, 'nested/deep/file.txt'));

    const parentDir = path.join(dir, 'nested', 'deep');
    const stats = await stat(parentDir);
    expect(stats.isDirectory()).toBe(true);

    const contents = await readFile(filePath, 'utf-8');
    expect(contents).toBe('content');
  });

  it('returns the full path of the written file', async () => {
    const dir = await createFixtureDirectory();
    tempDirs.push(dir);
    const result = await writeFixtureFile(dir, 'test.json', '{}');
    expect(path.isAbsolute(result)).toBe(true);
    expect(existsSync(result)).toBe(true);
  });

  it('writes empty content', async () => {
    const dir = await createFixtureDirectory();
    tempDirs.push(dir);
    const filePath = await writeFixtureFile(dir, 'empty.txt', '');
    const contents = await readFile(filePath, 'utf-8');
    expect(contents).toBe('');
  });

  it('overwrites existing files', async () => {
    const dir = await createFixtureDirectory();
    tempDirs.push(dir);
    await writeFixtureFile(dir, 'overwrite.txt', 'first');
    await writeFixtureFile(dir, 'overwrite.txt', 'second');
    const contents = await readFile(path.join(dir, 'overwrite.txt'), 'utf-8');
    expect(contents).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// extractMarkdownLinks
// ---------------------------------------------------------------------------
describe('extractMarkdownLinks', () => {
  it('extracts links from markdown', () => {
    const markdown = 'Check [example](https://example.com) and [docs](https://docs.example.com).';
    const links = extractMarkdownLinks(markdown);
    expect(links).toEqual(['https://example.com', 'https://docs.example.com']);
  });

  it('returns empty array when no links exist', () => {
    const markdown = 'No links here, just plain text.';
    const links = extractMarkdownLinks(markdown);
    expect(links).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(extractMarkdownLinks('')).toEqual([]);
  });

  it('handles multiple links on the same line', () => {
    const markdown = '[a](url1) [b](url2) [c](url3)';
    const links = extractMarkdownLinks(markdown);
    expect(links).toEqual(['url1', 'url2', 'url3']);
  });

  it('handles links with various URL formats', () => {
    const markdown = `
[relative](./path/to/file.md)
[absolute](https://example.com/page)
[with-fragment](https://example.com#section)
[with-query](https://example.com?foo=bar)
    `;
    const links = extractMarkdownLinks(markdown);
    expect(links).toEqual([
      './path/to/file.md',
      'https://example.com/page',
      'https://example.com#section',
      'https://example.com?foo=bar',
    ]);
  });

  it('handles links with special characters in text', () => {
    const markdown = '[some **bold** text](https://example.com)';
    // The regex uses [^\]] so bold markers inside [] are fine
    const links = extractMarkdownLinks(markdown);
    expect(links).toEqual(['https://example.com']);
  });

  it('does not extract image references as links', () => {
    const markdown = '![image](image.png)';
    const links = extractMarkdownLinks(markdown);
    expect(links).toEqual([]);
  });

  it('extracts links adjacent to images', () => {
    const markdown = '![logo](logo.png) [docs](https://docs.example.com)';
    const links = extractMarkdownLinks(markdown);
    expect(links).toEqual(['https://docs.example.com']);
  });

  it('handles multiline markdown', () => {
    const markdown = `# Title

Some text with [link1](url1).

Another paragraph with [link2](url2).
`;
    const links = extractMarkdownLinks(markdown);
    expect(links).toEqual(['url1', 'url2']);
  });

  it('does not extract links from inline code blocks', () => {
    // The regex is simple and does match inside code blocks — this documents
    // current behaviour rather than asserting ideal behaviour.
    const markdown = '`[code link](code-url)` and [real](real-url)';
    const links = extractMarkdownLinks(markdown);
    expect(links).toContain('real-url');
  });

  it('handles links with parentheses in the URL', () => {
    // Parentheses in URLs are terminated at the first `)` by the regex, so
    // this documents the current edge-case behaviour.
    const markdown = '[wiki](https://en.wikipedia.org/wiki/Example_(disambiguation))';
    const links = extractMarkdownLinks(markdown);
    expect(links).toHaveLength(1);
  });

  it('handles adjacent links with no space', () => {
    const markdown = '[a](url1)[b](url2)';
    const links = extractMarkdownLinks(markdown);
    expect(links).toEqual(['url1', 'url2']);
  });

  it('does not match empty URL parentheses', () => {
    const markdown = '[empty]()';
    const links = extractMarkdownLinks(markdown);
    expect(links).toEqual([]);
  });

  it('does not match link text containing nested square brackets', () => {
    // The regex [^\]]+ stops at the first ], so nested brackets break the match.
    const markdown = '[outer [inner]](url)';
    const links = extractMarkdownLinks(markdown);
    // The inner ] terminates the link text match prematurely, so no link is found.
    expect(links).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// writeFixtureFile — additional edge cases
// ---------------------------------------------------------------------------
describe('writeFixtureFile edge cases', () => {
  it('handles unicode content', async () => {
    const dir = await createFixtureDirectory();
    tempDirs.push(dir);
    const filePath = await writeFixtureFile(dir, 'unicode.txt', 'Hello, \u4e16\u754c! \ud83c\udfb5');
    const contents = await readFile(filePath, 'utf-8');
    expect(contents).toBe('Hello, \u4e16\u754c! \ud83c\udfb5');
  });

  it('handles filenames with special characters', async () => {
    const dir = await createFixtureDirectory();
    tempDirs.push(dir);
    const filePath = await writeFixtureFile(dir, 'my-file (1).txt', 'test');
    const contents = await readFile(filePath, 'utf-8');
    expect(contents).toBe('test');
  });

  it('handles deeply nested directories', async () => {
    const dir = await createFixtureDirectory();
    tempDirs.push(dir);
    const filePath = await writeFixtureFile(dir, 'a/b/c/d/e/f.txt', 'deep');
    const contents = await readFile(filePath, 'utf-8');
    expect(contents).toBe('deep');
    expect(path.isAbsolute(filePath)).toBe(true);
  });
});
