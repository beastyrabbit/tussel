import type { Command } from 'commander';
import { CommanderError } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { createProgram, main } from './index.js';

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

/** Build a program that throws CommanderError instead of calling process.exit. */
function createThrowingProgram(
  deps: ReturnType<typeof createDeps>,
  outputCapture?: { writeOut?: ReturnType<typeof vi.fn>; writeErr?: ReturnType<typeof vi.fn> },
): Command {
  const program = createProgram(deps);
  const writeErr = (outputCapture?.writeErr ?? vi.fn()) as (str: string) => void;
  const writeOut = (outputCapture?.writeOut ?? vi.fn()) as (str: string) => void;
  const cfg = { writeErr, writeOut };
  program.exitOverride().configureOutput(cfg);
  for (const cmd of program.commands) {
    cmd.exitOverride().configureOutput(cfg);
  }
  return program;
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

  it('rejects unknown commands', async () => {
    const deps = createDeps();
    const program = createThrowingProgram(deps);

    await expect(program.parseAsync(['node', 'tussel', 'bogus'], { from: 'node' })).rejects.toThrow(
      CommanderError,
    );
  });

  it('rejects convert without the required --to flag', async () => {
    const deps = createDeps();
    const program = createThrowingProgram(deps);

    await expect(
      program.parseAsync(['node', 'tussel', 'convert', 'demo.scene.ts'], { from: 'node' }),
    ).rejects.toThrow(CommanderError);

    expect(deps.convertScene).not.toHaveBeenCalled();
  });

  it('rejects render without the required --out flag', async () => {
    const deps = createDeps();
    const program = createThrowingProgram(deps);

    await expect(
      program.parseAsync(['node', 'tussel', 'render', 'demo.scene.ts'], { from: 'node' }),
    ).rejects.toThrow(CommanderError);

    expect(deps.renderScene).not.toHaveBeenCalled();
  });

  it('propagates errors from deps when an invalid file path is given', async () => {
    const deps = createDeps();
    vi.mocked(deps.checkScene).mockRejectedValue(new Error('ENOENT: no such file or directory'));

    await expect(
      main(['node', 'tussel', 'check', 'nonexistent.scene.ts'], deps),
    ).rejects.toThrow('ENOENT');
  });

  it('propagates errors from convertScene for invalid paths', async () => {
    const deps = createDeps();
    vi.mocked(deps.convertScene).mockRejectedValue(new Error('ENOENT: no such file or directory'));

    await expect(
      main(['node', 'tussel', 'convert', 'missing.scene.ts', '--to', 'scene-ts'], deps),
    ).rejects.toThrow('ENOENT');
  });

  it('prints help text and exits with --help', async () => {
    const deps = createDeps();
    const writeOut = vi.fn();
    const program = createThrowingProgram(deps, { writeOut });

    await expect(
      program.parseAsync(['node', 'tussel', '--help'], { from: 'node' }),
    ).rejects.toThrow(CommanderError);

    expect(writeOut).toHaveBeenCalledWith(expect.stringContaining('tussel'));
  });

  it('prints subcommand help text with <command> --help', async () => {
    const deps = createDeps();
    const writeOut = vi.fn();
    const program = createThrowingProgram(deps, { writeOut });

    await expect(
      program.parseAsync(['node', 'tussel', 'run', '--help'], { from: 'node' }),
    ).rejects.toThrow(CommanderError);

    expect(writeOut).toHaveBeenCalledWith(expect.stringContaining('--backend'));
  });

  it('enables watch by default for the run command', async () => {
    const deps = createDeps();

    await main(['node', 'tussel', 'run', 'demo.scene.ts'], deps);

    expect(deps.runScene).toHaveBeenCalledWith('demo.scene.ts', true, 'realtime', { entry: undefined });
  });

  it('disables watch with --no-watch', async () => {
    const deps = createDeps();

    await main(['node', 'tussel', 'run', 'demo.scene.ts', '--no-watch'], deps);

    expect(deps.runScene).toHaveBeenCalledWith('demo.scene.ts', false, 'realtime', { entry: undefined });
  });
});
