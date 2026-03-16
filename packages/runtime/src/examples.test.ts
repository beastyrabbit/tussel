import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { stableJson } from '@tussel/ir';
import { convertScene, prepareScene, renderScene } from '@tussel/runtime';
import { createFixtureDirectory, extractMarkdownLinks, writeFixtureFile } from '@tussel/testkit';
import { describe, expect, it } from 'vitest';

type SourceKind = 'script-ts' | 'scene-json' | 'scene-ts';

interface ExampleSet {
  dir: string;
  name: string;
  sceneJson: string;
  sceneTs: string;
  scriptTs: string;
}

const DOCS_ROOT = path.resolve('docs');
const EXAMPLES_ROOT = path.resolve('examples');
const CODE_ROOT = path.join(EXAMPLES_ROOT, 'code');
const FORMAT_EXTENSION: Record<SourceKind, string> = {
  'scene-json': '.scene.json',
  'scene-ts': '.scene.ts',
  'script-ts': '.script.ts',
};

describe('examples', () => {
  it('keeps every markdown link resolvable under docs/ and examples/', async () => {
    const markdownFiles = [
      ...(await listFiles(DOCS_ROOT, (filePath) => filePath.endsWith('.md'))),
      ...(await listFiles(EXAMPLES_ROOT, (filePath) => filePath.endsWith('.md'))),
    ];

    for (const markdownFile of markdownFiles) {
      const markdown = await readFile(markdownFile, 'utf8');
      const links = extractMarkdownLinks(markdown);

      for (const link of links) {
        if (isExternalLink(link) || link.startsWith('#')) {
          continue;
        }

        const resolved = path.resolve(path.dirname(markdownFile), stripLocalLinkDecorations(link));
        const info = await stat(resolved);
        expect(info.isFile() || info.isDirectory(), `${link} from ${markdownFile}`).toBe(true);
      }
    }
  });

  it('ships the required reference docs from the saved plan', async () => {
    const expectedDocs = [
      'README.md',
      'quickstart.md',
      'script-syntax.md',
      'scene-ts-reference.md',
      'scene-json-reference.md',
      'conversion-guide.md',
      'live-graph-rules.md',
      'worked-example-coastline.md',
    ];

    for (const fileName of expectedDocs) {
      const info = await stat(path.join(DOCS_ROOT, fileName));
      expect(info.isFile(), fileName).toBe(true);
    }
  });

  it('ships a complete script-ts, scene-ts, and scene-json trio for each example topic', async () => {
    const exampleSets = await loadExampleSets();

    expect(exampleSets.length).toBeGreaterThanOrEqual(7);

    for (const exampleSet of exampleSets) {
      for (const variant of [exampleSet.scriptTs, exampleSet.sceneTs, exampleSet.sceneJson]) {
        const info = await stat(variant);
        expect(info.isFile(), variant).toBe(true);
      }
    }
  });

  it('loads every stored example variant to the same structural scene graph', async () => {
    const exampleSets = await loadExampleSets();

    for (const exampleSet of exampleSets) {
      const baseline = stableJson((await prepareScene(exampleSet.scriptTs)).scene);
      const sceneTs = stableJson((await prepareScene(exampleSet.sceneTs)).scene);
      const sceneJson = stableJson((await prepareScene(exampleSet.sceneJson)).scene);

      expect(sceneTs, `${exampleSet.name} scene-ts drifted from script-ts`).toBe(baseline);
      expect(sceneJson, `${exampleSet.name} scene-json drifted from script-ts`).toBe(baseline);
    }
  }, 120_000);

  it('can regenerate scene-ts and scene-json from every script example', async () => {
    const rootDir = await createFixtureDirectory('tussel-examples-');
    const exampleSets = await loadExampleSets();

    for (const exampleSet of exampleSets) {
      const baseline = stableJson((await prepareScene(exampleSet.scriptTs)).scene);

      for (const target of ['scene-ts', 'scene-json'] satisfies SourceKind[]) {
        const rendered = await convertScene(exampleSet.scriptTs, target);
        const outputPath = await writeFixtureFile(
          rootDir,
          `${exampleSet.name}/${exampleSet.name}${FORMAT_EXTENSION[target]}`,
          rendered,
        );
        const prepared = await prepareScene(outputPath);
        expect(stableJson(prepared.scene), `${exampleSet.name} -> ${target} drifted`).toBe(baseline);
      }
    }
  }, 120_000);

  it('round-trips the dedicated conversion example across all source kinds', async () => {
    const rootDir = await createFixtureDirectory('tussel-roundtrip-');
    const exampleSet = (await loadExampleSets()).find(
      (candidate) => candidate.name === '06-converting-between-formats',
    );

    expect(exampleSet).toBeDefined();
    if (!exampleSet) {
      return;
    }

    const baseline = stableJson((await prepareScene(exampleSet.scriptTs)).scene);
    const sources: Record<SourceKind, string> = {
      'scene-json': exampleSet.sceneJson,
      'scene-ts': exampleSet.sceneTs,
      'script-ts': exampleSet.scriptTs,
    };

    for (const [sourceKind, sourcePath] of Object.entries(sources) as Array<[SourceKind, string]>) {
      for (const targetKind of Object.keys(FORMAT_EXTENSION) as SourceKind[]) {
        if (sourceKind === targetKind) {
          continue;
        }

        const rendered = await convertScene(sourcePath, targetKind);
        const outputPath = await writeFixtureFile(
          rootDir,
          `${sourceKind}-to-${targetKind}/${exampleSet.name}${FORMAT_EXTENSION[targetKind]}`,
          rendered,
        );
        const prepared = await prepareScene(outputPath);
        expect(stableJson(prepared.scene), `${sourceKind} -> ${targetKind} drifted`).toBe(baseline);
      }
    }
  }, 120_000);

  it('renders deterministic synth and sample fixtures offline', async () => {
    const rootDir = await createFixtureDirectory('tussel-render-');
    const examples = [
      {
        entry: path.join(CODE_ROOT, '01-first-sound', 'first-sound.scene.ts'),
        stem: 'first-sound',
      },
      {
        entry: path.join(CODE_ROOT, '04-samples-and-cache', 'samples-and-cache.scene.ts'),
        stem: 'samples-and-cache',
      },
    ];

    for (const example of examples) {
      const firstOutput = path.join(rootDir, `${example.stem}.first.wav`);
      const secondOutput = path.join(rootDir, `${example.stem}.second.wav`);

      await renderScene(example.entry, firstOutput, 2);
      await renderScene(example.entry, secondOutput, 2);

      const [firstBuffer, secondBuffer] = await Promise.all([readFile(firstOutput), readFile(secondOutput)]);
      expect(firstBuffer.byteLength, example.entry).toBeGreaterThan(44);
      expect(secondBuffer.equals(firstBuffer), `${example.stem} render changed between runs`).toBe(true);
    }
  }, 120_000);
});

async function loadExampleSets(): Promise<ExampleSet[]> {
  const entries = await readdir(CODE_ROOT, { withFileTypes: true });
  const exampleSets: ExampleSet[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dir = path.join(CODE_ROOT, entry.name);
    const files = await readdir(dir);
    const scriptName = files.find((fileName) => fileName.endsWith('.script.ts'));
    const sceneTsName = files.find((fileName) => fileName.endsWith('.scene.ts'));
    const sceneJsonName = files.find((fileName) => fileName.endsWith('.scene.json'));

    expect(scriptName, `missing script-ts in ${dir}`).toBeDefined();
    expect(sceneTsName, `missing scene-ts in ${dir}`).toBeDefined();
    expect(sceneJsonName, `missing scene-json in ${dir}`).toBeDefined();

    if (!scriptName || !sceneTsName || !sceneJsonName) {
      continue;
    }

    exampleSets.push({
      dir,
      name: entry.name,
      sceneJson: path.join(dir, sceneJsonName),
      sceneTs: path.join(dir, sceneTsName),
      scriptTs: path.join(dir, scriptName),
    });
  }

  return exampleSets.sort((left, right) => left.name.localeCompare(right.name));
}

async function listFiles(rootDir: string, predicate: (filePath: string) => boolean): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return listFiles(entryPath, predicate);
      }
      return predicate(entryPath) ? [entryPath] : [];
    }),
  );

  return files.flat().sort((left, right) => left.localeCompare(right));
}

function isExternalLink(link: string): boolean {
  return /^[a-z]+:/i.test(link);
}

function stripLocalLinkDecorations(link: string): string {
  return link.replace(/[?#].*$/, '');
}
