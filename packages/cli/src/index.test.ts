import { describe, expect, it, vi } from 'vitest';
import { main } from './index.js';

function createDeps(): NonNullable<Parameters<typeof main>[1]> {
  return {
    checkScene: vi.fn(),
    convertScene: vi.fn(),
    importExternalSource: vi.fn(),
    log: vi.fn(),
    renderScene: vi.fn(),
    runScene: vi.fn(),
    stdout: { write: vi.fn() },
    writeFile: vi.fn(),
  };
}

describe('@tussel/cli', () => {
  it('reports scene summaries for the check command', async () => {
    const deps = createDeps();
    vi.mocked(deps.checkScene).mockResolvedValue({
      canonicalSceneTsPath: 'scene.ts',
      dependencies: [],
      generatedPath: 'generated.ts',
      kind: 'scene-ts',
      scene: {
        channels: { drums: { node: 'bd' }, lead: { node: 'sine' } },
        samples: [{ ref: 'kit' }],
        transport: {},
      },
    } as Awaited<ReturnType<typeof deps.checkScene>>);

    await main(['node', 'tussel', 'check', 'demo.scene.ts'], deps);

    expect(deps.checkScene).toHaveBeenCalledWith('demo.scene.ts', { entry: undefined });
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('2 channels, 1 sample source(s)'));
  });

  it('writes converted output to a file when --out is provided', async () => {
    const deps = createDeps();
    vi.mocked(deps.convertScene).mockResolvedValue('export default {};');

    await main(
      ['node', 'tussel', 'convert', 'demo.scene.ts', '--to', 'scene-ts', '--out', 'out.scene.ts'],
      deps,
    );

    expect(deps.convertScene).toHaveBeenCalledWith('demo.scene.ts', 'scene-ts', { entry: undefined });
    expect(deps.writeFile).toHaveBeenCalledWith('out.scene.ts', 'export default {};');
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Wrote out.scene.ts'));
  });

  it('supports hydra-js as a convert target', async () => {
    const deps = createDeps();
    vi.mocked(deps.convertScene).mockResolvedValue('export default async function runHydra() {}');

    await main(['node', 'tussel', 'convert', 'demo.scene.ts', '--to', 'hydra-js'], deps);

    expect(deps.convertScene).toHaveBeenCalledWith('demo.scene.ts', 'hydra-js', { entry: undefined });
    expect(deps.stdout.write).toHaveBeenCalledWith('export default async function runHydra() {}');
  });

  it('passes backend and watch options through to the run command', async () => {
    const deps = createDeps();

    await main(['node', 'tussel', 'run', 'demo.scene.ts', '--backend', 'offline'], deps);

    expect(deps.runScene).toHaveBeenCalledWith('demo.scene.ts', true, 'offline', { entry: undefined });
  });
});
