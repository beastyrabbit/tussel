import { readFile, stat } from 'node:fs/promises';
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

  it('keeps trailing state calls out of the live root selection', async () => {
    const prepared = await prepareSceneFromSource(
      'script-ts',
      `scene({ channels: { lead: { node: s("bd") } }, master: {} });\nsetcpm(120);\n`,
      { filename: 'trailing-state.script.ts' },
    );

    expect(Object.keys(prepared.scene.channels)).toEqual(['lead']);
    expect(prepared.scene.transport.cps).toBe(2);
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

  it('rewrites muted layer syntax and visual helpers deterministically', () => {
    expect(
      normalizeStrudelSource(`setcpm(120)
$: s("bd").color("red")
_$: s("hh")._scope()
$: note("c e g").punchcard()
`),
    ).toBe(`setcps((120) / 60)

stack(
  s("bd"),
  note("c e g")
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
