import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { resetCsoundRegistry, resetInputRegistry } from '@tussel/dsl';
import {
  convertScene,
  normalizeStrudelSource,
  prepareScene,
  prepareSceneFromSource,
  queryPreparedScene,
  renderHydraModule,
  renderScene,
} from '@tussel/runtime';
import { createFixtureDirectory, extractMarkdownLinks, writeFixtureFile } from '@tussel/testkit';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  resetCsoundRegistry();
  resetInputRegistry();
});

describe('runtime pipeline', () => {
  it('prepares script-ts sources', async () => {
    const rootDir = await createFixtureDirectory();
    const entry = await writeFixtureFile(
      rootDir,
      'first.script.ts',
      `// "First sound"\nsetcps(0.5);\nstack(s("bd hh"), n("0 2 4").s("sine").gain(0.1));\n`,
    );

    const prepared = await prepareScene(entry);
    expect(Object.keys(prepared.scene.channels)).toEqual(['layer1', 'layer2']);
    expect(prepared.scene.transport.cps).toBe(0.5);
  });

  it('keeps generated artifacts distinct for same-basename entries in different directories', async () => {
    const rootDir = await createFixtureDirectory();
    const firstEntry = await writeFixtureFile(rootDir, 'alpha/shared.script.ts', `s("bd")\n`);
    const secondEntry = await writeFixtureFile(rootDir, 'beta/shared.script.ts', `s("hh")\n`);

    const [firstPrepared, secondPrepared] = await Promise.all([prepareScene(firstEntry), prepareScene(secondEntry)]);

    expect(firstPrepared.generatedPath).not.toBe(secondPrepared.generatedPath);
    expect(firstPrepared.canonicalSceneTsPath).not.toBe(secondPrepared.canonicalSceneTsPath);
  });

  it('prepares same-basename entries in parallel without cache collisions', async () => {
    const rootDir = await createFixtureDirectory();
    await writeFixtureFile(rootDir, 'package.json', '{"name":"fixture-root","private":true}\n');
    const first = await writeFixtureFile(rootDir, 'alpha/live.script.ts', `setcps(1);\ns("bd");\n`);
    const second = await writeFixtureFile(rootDir, 'beta/live.script.ts', `setcps(1);\ns("hh");\n`);

    const [preparedFirst, preparedSecond] = await Promise.all([prepareScene(first), prepareScene(second)]);

    expect(preparedFirst.projectRoot).toBe(rootDir);
    expect(preparedSecond.projectRoot).toBe(rootDir);
    expect(preparedFirst.generatedPath).not.toBe(preparedSecond.generatedPath);
    expect(queryPreparedScene(preparedFirst, 0, 1, { cps: 1 })[0]?.payload.s).toBe('bd');
    expect(queryPreparedScene(preparedSecond, 0, 1, { cps: 1 })[0]?.payload.s).toBe('hh');
  });

  it('keeps trailing state calls out of the live root selection', async () => {
    const prepared = await prepareSceneFromSource(
      'script-ts',
      `scene({ channels: { lead: { node: s("bd") } }, master: {} });\nsetcpm(120);\n`,
      { filename: 'trailing-state.script.ts' },
    );

    expect(Object.keys(prepared.scene.channels)).toEqual(['lead']);
    expect(prepared.scene.transport.cps).toBe(2);
  });

  it('rejects custom params during runtime preparation until execution support exists', async () => {
    await expect(
      prepareSceneFromSource(
        'scene-json',
        JSON.stringify({
          channels: {
            lead: {
              node: {
                args: [0.5],
                exprType: 'pattern',
                kind: 'method',
                name: 'wobble',
                target: {
                  args: ['bd'],
                  exprType: 'pattern',
                  kind: 'call',
                  name: 's',
                },
              },
            },
          },
          samples: [],
          transport: { cps: 1 },
        }),
        {
          filename: 'custom-param.scene.json',
        },
      ),
    ).rejects.toThrow(/createParam\(\) and createParams\(\) are not executable yet|Property 'wobble' does not exist/);
  });

  it('round-trips scene-json to scene-ts', async () => {
    const rootDir = await createFixtureDirectory();
    const entry = await writeFixtureFile(
      rootDir,
      'fixture.scene.json',
      JSON.stringify(
        {
          channels: {
            drums: { node: { kind: 'call', name: 's', exprType: 'pattern', args: ['bd hh'] } },
          },
          samples: [],
          transport: { cps: 0.5 },
        },
        null,
        2,
      ),
    );

    const converted = await convertScene(entry, 'scene-ts');
    expect(converted).toContain('defineScene');
    expect(converted).toContain('drums');
  });

  it('typechecks scene-ts entries even when the project tsconfig does not enable allowImportingTsExtensions', async () => {
    const rootDir = await createFixtureDirectory();
    await writeFixtureFile(rootDir, 'package.json', '{"name":"fixture-root","private":true,"type":"module"}\n');
    await writeFixtureFile(
      rootDir,
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            target: 'ES2022',
          },
        },
        null,
        2,
      ),
    );
    const entry = await writeFixtureFile(
      rootDir,
      'consumer.scene.ts',
      `export default {\n  channels: {\n    lead: {\n      node: { kind: 'call', name: 's', args: ['bd'], exprType: 'pattern' }\n    }\n  },\n  samples: [],\n  transport: { cps: 1 }\n};\n`,
    );

    const prepared = await prepareScene(entry);

    expect(Object.keys(prepared.scene.channels)).toEqual(['lead']);
    expect(queryPreparedScene(prepared, 0, 1, { cps: 1 })[0]?.payload.s).toBe('bd');
  });

  it('renders a short offline file', async () => {
    const rootDir = await createFixtureDirectory();
    const entry = await writeFixtureFile(
      rootDir,
      'offline.scene.ts',
      `import { defineScene, s } from '@tussel/dsl';\n\nexport default defineScene({ transport: { cps: 0.5 }, samples: [], channels: { lead: { node: s("sine").note("C4").gain(0.05) } } });\n`,
    );
    const output = path.join(rootDir, 'render.wav');
    await renderScene(entry, output, 1);
    const info = await stat(output);
    expect(info.size).toBeGreaterThan(44);
  });

  it('isolates generated artifacts for same-basename entries prepared in parallel', async () => {
    const rootDir = await createFixtureDirectory();
    const left = await writeFixtureFile(
      rootDir,
      'alpha/live.script.ts',
      `scene({ channels: { lead: { node: s("bd") } }, samples: [], transport: { cps: 1 } });\n`,
    );
    const right = await writeFixtureFile(
      rootDir,
      'beta/live.script.ts',
      `scene({ channels: { lead: { node: s("hh") } }, samples: [], transport: { cps: 1 } });\n`,
    );

    const [preparedLeft, preparedRight] = await Promise.all([prepareScene(left), prepareScene(right)]);

    expect(preparedLeft.generatedPath).not.toBe(preparedRight.generatedPath);
    expect(preparedLeft.scene.channels.lead?.node).not.toEqual(preparedRight.scene.channels.lead?.node);
  });

  it('renders relative sample packs from the entry project root instead of process cwd', async () => {
    const rootDir = await createFixtureDirectory();
    const packDir = path.join(rootDir, 'nested', 'kit');
    await mkdir(packDir, { recursive: true });
    await writeFixtureFile(rootDir, 'nested/kit/strudel.json', JSON.stringify({ _base: '.', bd: 'bd.wav' }));
    await copyFile(path.resolve('reference', 'assets', 'basic-kit', 'bd.wav'), path.join(packDir, 'bd.wav'));

    const entry = await writeFixtureFile(
      rootDir,
      'nested/relative-samples.scene.ts',
      `import { defineScene, s } from '@tussel/dsl';\n\nexport default defineScene({ samples: [{ ref: "./kit" }], channels: { lead: { node: s("bd").gain(0.05) } }, transport: { cps: 1 } });\n`,
    );
    const output = path.join(rootDir, 'relative-samples.wav');

    await renderScene(entry, output, 1);

    const info = await stat(output);
    expect(info.size).toBeGreaterThan(44);
  });

  it('keeps markdown links resolvable', async () => {
    const readmePath = path.resolve('examples', 'README.md');
    const markdown = await readFile(readmePath, 'utf8');
    const links = extractMarkdownLinks(markdown);
    expect(links.length).toBeGreaterThan(0);
  });

  it('requires --entry for ambiguous external Strudel scripts', async () => {
    await expect(
      prepareSceneFromSource('strudel-js', `const drums = s("bd");\nconst hats = s("hh");\ndrums;\nhats;\n`, {
        filename: 'ambiguous.strudel.js',
      }),
    ).rejects.toThrow('Ambiguous external script root. Pass --entry <binding-or-root> to select a binding.');
  });

  it('resolves external Strudel bindings through --entry without leaving DSL globals behind', async () => {
    const globals = globalThis as Record<string, unknown>;
    const previousExisted = Object.hasOwn(globals, 's');
    const previous = globals.s;
    const sentinel = Symbol('sentinel');
    globals.s = sentinel;

    try {
      const prepared = await prepareSceneFromSource(
        'strudel-js',
        `const drums = s("bd");\nconst hats = s("hh");\nsetcps(0.75);\n`,
        { entry: 'hats', filename: 'entry-selected.strudel.js' },
      );

      expect(Object.keys(prepared.scene.channels)).toEqual(['hats']);
      expect(prepared.scene.transport.cps).toBe(0.75);
      expect(globals.s).toBe(sentinel);
    } finally {
      if (previousExisted) {
        globals.s = previous;
      } else {
        delete globals.s;
      }
    }
  });

  it('normalizes Strudel learning syntax into importable source', async () => {
    const prepared = await prepareSceneFromSource(
      'strudel-js',
      `setcpm(90/4)
$: s("bd sd").color("cyan")
$: note("c e g").sound("triangle").punchcard()
`,
      { filename: 'learning-syntax.strudel.js' },
    );

    expect(prepared.scene.transport.cps).toBe(0.375);
    expect(Object.keys(prepared.scene.channels)).toEqual(['d1', 'd2']);
  });

  it('adds the default Strudel drum kit for imported scripts that use basic drum sounds', async () => {
    const prepared = await prepareSceneFromSource('strudel-js', `s("bd hh sd rim")`, {
      filename: 'default-drums.strudel.js',
    });

    expect(prepared.scene.samples).toEqual([{ ref: path.resolve('reference', 'assets', 'basic-kit') }]);
  });

  it('adds the default Strudel drum kit for imported Tidal sources that use basic drum sounds', async () => {
    const prepared = await prepareSceneFromSource('tidal', `sound "bd hh sd rim"`, {
      filename: 'default-drums.tidal',
    });

    expect(prepared.scene.samples).toEqual([{ ref: path.resolve('reference', 'assets', 'basic-kit') }]);
  });

  it('imports seq-based Strudel examples into structural scenes', async () => {
    const prepared = await prepareSceneFromSource('strudel-js', `note(seq("c3", "eb3", "g3"))`, {
      filename: 'seq-example.strudel.js',
    });

    expect(Object.keys(prepared.scene.channels)).toEqual(['d1']);
  });

  it('treats csound setup calls as non-root expressions in external scripts', async () => {
    const fetchMock = vi.fn(async () => new Response('instr FM1\nendin', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const prepared = await prepareSceneFromSource(
      'strudel-js',
      `await loadOrc('github:kunstmusik/csound-live-code/master/livecode.orc')\nnote("c4 e4").csound("FM1")`,
      { filename: 'csound-load.strudel.js' },
    );

    expect(Object.keys(prepared.scene.channels)).toEqual(['d1']);
    expect(queryPreparedScene(prepared, 0, 1, { cps: 1 }).map((event) => event.payload.csound)).toEqual([
      'FM1',
      'FM1',
    ]);
  });

  it('supports inline loadCsound template tags in external scripts', async () => {
    const prepared = await prepareSceneFromSource(
      'strudel-js',
      `await loadCsound\`instr CoolSynth\nendin\`\nnote("c4").csoundm("CoolSynth")`,
      { filename: 'csound-inline.strudel.js' },
    );

    expect(Object.keys(prepared.scene.channels)).toEqual(['d1']);
    expect(queryPreparedScene(prepared, 0, 1, { cps: 1 })[0]?.payload.csoundm).toBe('CoolSynth');
  });

  it('treats hydra and input setup calls as non-root expressions in external scripts', async () => {
    const prepared = await prepareSceneFromSource(
      'strudel-js',
      `await initHydra({ feedStrudel: 1 })\nhydra(\`osc(10).out()\`)\nsetInputValue("knob:one", 0.5)\nnote(input("knob:one").range(0, 12))`,
      { filename: 'hydra-input-setup.strudel.js' },
    );

    expect(Object.keys(prepared.scene.channels)).toEqual(['d1']);
    expect(prepared.scene.metadata?.hydra).toEqual({
      options: { feedStrudel: 1 },
      programs: [{ code: 'osc(10).out()' }],
    });
    expect(prepared.hydraArtifactPath).toBeTruthy();
    await expect(readFile(prepared.hydraArtifactPath as string, 'utf8')).resolves.toContain('osc(10).out()');
    expect(queryPreparedScene(prepared, 0, 1, { cps: 1 })[0]?.payload.note).toBe(6);
  });

  it('keeps string prototype helpers opt-in in the host process while bundled scripts still work', async () => {
    const globals = globalThis as Record<string, unknown>;
    const previousFast = (String.prototype as unknown as Record<string, unknown>).fast;

    const prepared = await prepareSceneFromSource('script-ts', `"1 0".fast(2)`, {
      filename: 'string-helpers.script.ts',
    });

    expect(Object.keys(prepared.scene.channels)).toHaveLength(1);
    expect((String.prototype as unknown as Record<string, unknown>).fast).toBe(previousFast);
    expect(globals.installStringPrototypeExtensions).toBeUndefined();
  });

  it('renders hydra metadata into a runnable compatibility module', () => {
    const rendered = renderHydraModule({
      channels: {},
      metadata: {
        hydra: {
          options: { detectAudio: true },
          programs: [{ code: 'osc(20).out()' }],
        },
      },
      samples: [],
      transport: {},
    });

    expect(rendered).toContain('export const hydraOptions');
    expect(rendered).toContain('osc(20).out()');
    expect(rendered).toContain('export default async function runHydra');
  });

  it('rewrites muted layer syntax and preserves visual helpers', () => {
    expect(
      normalizeStrudelSource(`setcpm(120)
$: s("bd").color("red")
_$: s("hh")._scope()
$: note("c e g").punchcard()
`),
    ).toBe(`setcps((120) / 60)

stack(
  s("bd").color("red"),
  note("c e g").punchcard()
)`);
  });

  it('prepares the manual user-audio coastline file', async () => {
    const prepared = await prepareScene(
      path.resolve('examples', 'manual-audio', 'coastline.user-audio.script.ts'),
    );

    expect(Object.keys(prepared.scene.channels).length).toBeGreaterThan(0);
    expect(prepared.scene.samples).toEqual([{ ref: './examples/assets/basic-kit' }]);
  });
});

// ---------------------------------------------------------------------------
// normalizeStrudelSource — focused unit tests
// ---------------------------------------------------------------------------
describe('normalizeStrudelSource', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeStrudelSource('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeStrudelSource('   \n  \n  ')).toBe('');
  });

  it('returns already-normalized code unchanged (no layers, no setcpm)', () => {
    const code = 's("bd hh").fast(2)';
    expect(normalizeStrudelSource(code)).toBe(code);
  });

  it('rewrites setcpm to setcps division', () => {
    expect(normalizeStrudelSource('setcpm(120)')).toBe('setcps((120) / 60)');
  });

  it('rewrites setcpm with expression argument', () => {
    expect(normalizeStrudelSource('setcpm(90/4)')).toBe('setcps((90/4) / 60)');
  });

  it('does not rewrite identifiers that contain setcpm as a substring', () => {
    const code = 'mysetcpm(120)';
    expect(normalizeStrudelSource(code)).toBe(code);
  });

  it('rewrites multiple setcpm calls in the same source', () => {
    const code = 'setcpm(60)\nsetcpm(120)';
    expect(normalizeStrudelSource(code)).toBe('setcps((60) / 60)\nsetcps((120) / 60)');
  });

  it('converts single layer to a stack with one entry', () => {
    const result = normalizeStrudelSource('$: s("bd")');
    expect(result).toContain('stack(');
    expect(result).toContain('s("bd")');
  });

  it('converts multiple layers to stack', () => {
    const result = normalizeStrudelSource('$: s("bd")\n$: s("hh")');
    expect(result).toContain('stack(');
    expect(result).toContain('s("bd")');
    expect(result).toContain('s("hh")');
  });

  it('omits muted layers (_$:) from the output', () => {
    const result = normalizeStrudelSource('$: s("bd")\n_$: s("hh")\n$: note("c e g")');
    expect(result).toContain('s("bd")');
    expect(result).not.toContain('s("hh")');
    expect(result).toContain('note("c e g")');
  });

  it('preserves non-layer state calls before layers', () => {
    const result = normalizeStrudelSource('setcps(0.5)\n$: s("bd")');
    expect(result).toContain('setcps(0.5)');
    expect(result).toContain('stack(');
  });

  it('handles layer continuation with method chaining on next line', () => {
    const result = normalizeStrudelSource('$: s("bd")\n  .fast(2)\n$: s("hh")');
    expect(result).toContain('.fast(2)');
    expect(result).toContain('stack(');
  });

  it('handles layer continuation with dot prefix', () => {
    const result = normalizeStrudelSource('$: s("bd")\n.gain(0.5)');
    expect(result).toContain('.gain(0.5)');
    expect(result).toContain('stack(');
  });

  it('combines setcpm rewriting with layer rewriting', () => {
    const result = normalizeStrudelSource('setcpm(120)\n$: s("bd")\n$: s("hh")');
    expect(result).toContain('setcps((120) / 60)');
    expect(result).toContain('stack(');
  });
});
