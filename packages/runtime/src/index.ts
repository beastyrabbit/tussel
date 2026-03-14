import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RealtimeAudioEngine, renderSceneToFile } from '@tussel/audio';
import { type ExternalDispatchEvent, type PlaybackEvent, type QueryContext, queryScene } from '@tussel/core';
import * as tusselDsl from '@tussel/dsl';
import {
  collectCustomParamNames as collectCustomParamNamesFromIR,
  type HydraSceneSpec,
  isExpressionNode,
  isPlainObject,
  type MetadataSpec,
  normalizeHydraSceneSpec,
  renderValue,
  type SceneSpec,
  sceneSchema,
  stableJson,
} from '@tussel/ir';
import { Ajv2020 } from 'ajv/dist/2020.js';
import chokidar, { type FSWatcher } from 'chokidar';
import { build as esbuild, type Plugin } from 'esbuild';
import pc from 'picocolors';
import ts from 'typescript';

export { translateTidalToStrudelProgram } from './tidal.js';

import { normalizeStrudelSource } from './strudel-normalize.js';
import { translateTidalToSceneModule } from './tidal.js';

export { normalizeStrudelSource } from './strudel-normalize.js';

export type NativeSourceKind = 'hydra-js' | 'scene-json' | 'scene-ts' | 'script-ts';
export type ExternalSourceKind = 'strudel-js' | 'strudel-mjs' | 'strudel-ts' | 'tidal';
export type SourceKind = ExternalSourceKind | NativeSourceKind;

export interface ImportedScene {
  dependencies: string[];
  canonicalSceneTsPath: string;
  generatedPath: string;
  hydraArtifactPath?: string;
  kind: SourceKind;
  importSource?: 'strudel' | 'tidal';
  scene: SceneSpec;
}

export type PreparedScene = ImportedScene;

export interface PrepareSceneOptions {
  entry?: string;
}

export interface RunSceneOptions extends PrepareSceneOptions {
  onExternalDispatch?: (dispatch: ExternalDispatchEvent, targetTime: number) => void | Promise<void>;
}

const ajv = new Ajv2020({
  allErrors: true,
});
const validateSceneJson = ajv.compile(sceneSchema);
const STATE_CALL_NAMES = new Set(['samples', 'setbpm', 'setcpm', 'setcps']);
const SETUP_CALL_NAMES = new Set([
  ...STATE_CALL_NAMES,
  'clearHydra',
  'hydra',
  'initHydra',
  'loadCSound',
  'loadCsound',
  'loadOrc',
  'loadcsound',
  'setGamepadValue',
  'setInputValue',
  'setMidiValue',
  'setMotionValue',
]);
const DEFAULT_STRUDEL_SAMPLE_NAMES = ['bd', 'hh', 'rim', 'sd'] as const;
/** Resolve relative to this source file so the path is correct regardless of CWD. */
const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_STRUDEL_SAMPLE_PACK = path.resolve(PACKAGE_DIR, '..', '..', 'reference', 'assets', 'basic-kit');
const workspaceAliasPlugin: Plugin = {
  name: 'tussel-workspace-alias',
  setup(build) {
    build.onResolve({ filter: /^@tussel\/(.+)$/ }, (args) => {
      const match = /^@tussel\/(.+)$/.exec(args.path);
      const packageName = match?.[1];
      if (!packageName) {
        return null;
      }
      return {
        path: path.resolve(process.cwd(), 'packages', packageName, 'src', 'index.ts'),
      };
    });
  },
};

export async function prepareScene(
  entryPath: string,
  options: PrepareSceneOptions = {},
): Promise<PreparedScene> {
  const absoluteEntry = path.resolve(entryPath);
  const kind = detectSourceKind(absoluteEntry);
  const cacheDir = path.resolve('.tussel-cache', 'generated');
  const importedCacheDir = path.resolve('.tussel-cache', 'imported');
  await mkdir(cacheDir, { recursive: true });
  await mkdir(importedCacheDir, { recursive: true });

  let generatedPath = absoluteEntry;
  let importSource: ImportedScene['importSource'];
  switch (kind) {
    case 'script-ts': {
      const source = await readFile(absoluteEntry, 'utf8');
      const metadata = parseMetadata(source);
      generatedPath = path.join(cacheDir, `${path.basename(absoluteEntry, '.script.ts')}.generated.scene.ts`);
      const transformed = transformScriptToSceneModule(source, metadata, absoluteEntry, generatedPath, {
        scriptKind: ts.ScriptKind.TS,
      });
      await writeFile(generatedPath, transformed);
      break;
    }
    case 'scene-json': {
      const raw = JSON.parse(await readFile(absoluteEntry, 'utf8')) as unknown;
      if (!validateSceneJson(raw)) {
        throw new Error(ajv.errorsText(validateSceneJson.errors));
      }
      generatedPath = path.join(
        cacheDir,
        `${path.basename(absoluteEntry, '.scene.json')}.generated.scene.ts`,
      );
      await writeFile(generatedPath, renderSceneModule(raw as SceneSpec));
      break;
    }
    case 'scene-ts':
      generatedPath = path.join(cacheDir, `${path.basename(absoluteEntry, '.scene.ts')}.generated.scene.ts`);
      await writeFile(
        generatedPath,
        `export { default } from ${JSON.stringify(relativeModuleSpecifier(generatedPath, absoluteEntry))};\n`,
      );
      break;
    case 'strudel-ts': {
      const rawSource = await readFile(absoluteEntry, 'utf8');
      const metadata = parseMetadata(rawSource);
      const source = normalizeStrudelSource(rawSource);
      generatedPath = path.join(
        cacheDir,
        `${path.basename(absoluteEntry, '.strudel.ts')}.generated.scene.ts`,
      );
      await writeFile(
        generatedPath,
        withTsNoCheck(
          transformScriptToSceneModule(source, metadata, absoluteEntry, generatedPath, {
            rootEntry: options.entry,
            scriptKind: ts.ScriptKind.TS,
            strictRootSelection: true,
          }),
        ),
      );
      importSource = 'strudel';
      break;
    }
    case 'strudel-js':
    case 'strudel-mjs': {
      const rawSource = await readFile(absoluteEntry, 'utf8');
      const metadata = parseMetadata(rawSource);
      const source = normalizeStrudelSource(rawSource);
      const extension = kind === 'strudel-js' ? '.strudel.js' : '.strudel.mjs';
      generatedPath = path.join(cacheDir, `${path.basename(absoluteEntry, extension)}.generated.scene.ts`);
      await writeFile(
        generatedPath,
        withTsNoCheck(
          transformScriptToSceneModule(source, metadata, absoluteEntry, generatedPath, {
            rootEntry: options.entry,
            scriptKind: ts.ScriptKind.JS,
            strictRootSelection: true,
          }),
        ),
      );
      importSource = 'strudel';
      break;
    }
    case 'tidal': {
      const source = await readFile(absoluteEntry, 'utf8');
      generatedPath = path.join(cacheDir, `${path.basename(absoluteEntry, '.tidal')}.generated.scene.ts`);
      await writeFile(generatedPath, withTsNoCheck(translateTidalToSceneModule(source, options)));
      importSource = 'tidal';
      break;
    }
  }

  const diagnostics = typecheckFile(generatedPath);
  if (diagnostics.length > 0) {
    throw new Error(formatDiagnostics(diagnostics));
  }

  const scene = normalizeImportedScene(await executeSceneModule(generatedPath), importSource, options);
  const canonicalSceneTsPath = path.join(importedCacheDir, `${cacheStem(absoluteEntry)}.imported.scene.ts`);
  await writeFile(canonicalSceneTsPath, renderSceneModule(scene));
  const hydraArtifactPath = await writeHydraArtifactForScene(
    scene,
    path.join(importedCacheDir, `${cacheStem(absoluteEntry)}.hydra.js`),
  );
  const dependencies = await collectDependencies(absoluteEntry);
  return { canonicalSceneTsPath, dependencies, generatedPath, hydraArtifactPath, importSource, kind, scene };
}

export async function prepareSceneFromSource(
  kind: SourceKind,
  code: string,
  options: PrepareSceneOptions & { filename?: string } = {},
): Promise<ImportedScene> {
  const extension = extensionForSourceKind(kind);
  const hash = hashContent(`${kind}:${options.filename ?? 'inline'}:${code}`);
  const fallbackName = `${hash}${extension}`;
  const sourceName = options.filename
    ? `${path.basename(options.filename, extension)}-${hash.slice(0, 8)}${extension}`
    : fallbackName;
  const sourceFile = path.resolve('.tussel-cache', 'sources', sourceName);
  await mkdir(path.dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, code);
  return prepareScene(sourceFile, options);
}

export async function importExternalSource(
  entryPath: string,
  options: PrepareSceneOptions = {},
): Promise<ImportedScene> {
  const prepared = await prepareScene(entryPath, options);
  if (!isExternalSourceKind(prepared.kind)) {
    throw new Error(`Expected external source, received ${prepared.kind}`);
  }
  return prepared;
}

export function queryPreparedScene(
  prepared: Pick<PreparedScene, 'scene'>,
  begin: number,
  end: number,
  context: QueryContext = { cps: 0.5 },
): PlaybackEvent[] {
  return queryScene(prepared.scene, begin, end, context);
}

export async function convertScene(
  entryPath: string,
  target: NativeSourceKind,
  options: PrepareSceneOptions = {},
): Promise<string> {
  const prepared = await prepareScene(entryPath, options);
  switch (target) {
    case 'hydra-js': {
      const hydraModule = renderHydraModule(prepared.scene);
      if (!hydraModule) {
        throw new Error('Scene does not contain Hydra metadata to export.');
      }
      return hydraModule;
    }
    case 'scene-json':
      return stableJson(prepared.scene);
    case 'scene-ts':
      return renderSceneModule(prepared.scene);
    case 'script-ts':
      return renderScriptModule(prepared.scene);
  }
}

export async function checkScene(
  entryPath: string,
  options: PrepareSceneOptions = {},
): Promise<PreparedScene> {
  return prepareScene(entryPath, options);
}

export async function runScene(
  entryPath: string,
  watch: boolean,
  backend: 'offline' | 'realtime',
  options: RunSceneOptions = {},
): Promise<void> {
  const engine = new RealtimeAudioEngine({
    onExternalDispatch: options.onExternalDispatch,
    sinkless: backend === 'offline',
  });
  let watcher: FSWatcher | undefined;

  const loadAndApply = async (): Promise<PreparedScene | undefined> => {
    try {
      const prepared = await prepareScene(entryPath, options);
      await engine.updateScene(prepared.scene);
      printSuccess(prepared);
      if (watcher) {
        await watcher.close();
        watcher = undefined;
      }
      if (watch) {
        watcher = await watchDependencies(prepared.dependencies, async () => {
          await loadAndApply();
        });
      }
      return prepared;
    } catch (error) {
      console.error(pc.red((error as Error).message));
      return undefined;
    }
  };

  const initial = await loadAndApply();
  if (!initial) {
    process.exitCode = 1;
  }

  if (!watch) {
    return;
  }

  await new Promise<void>((resolve) => {
    const handleSignal = async () => {
      await watcher?.close();
      await engine.stop();
      resolve();
    };

    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);
  });
}

export async function renderScene(
  entryPath: string,
  outputPath: string,
  seconds = 8,
  options: PrepareSceneOptions = {},
): Promise<void> {
  const prepared = await prepareScene(entryPath, options);
  await renderSceneToFile(prepared.scene, path.resolve(outputPath), seconds);
}

function isExternalSourceKind(kind: SourceKind): kind is ExternalSourceKind {
  return kind === 'strudel-js' || kind === 'strudel-mjs' || kind === 'strudel-ts' || kind === 'tidal';
}

function extensionForSourceKind(kind: SourceKind): string {
  switch (kind) {
    case 'hydra-js':
      return '.hydra.js';
    case 'scene-json':
      return '.scene.json';
    case 'scene-ts':
      return '.scene.ts';
    case 'script-ts':
      return '.script.ts';
    case 'strudel-js':
      return '.strudel.js';
    case 'strudel-mjs':
      return '.strudel.mjs';
    case 'strudel-ts':
      return '.strudel.ts';
    case 'tidal':
      return '.tidal';
  }
}

function cacheStem(entryPath: string): string {
  const sourceKind = detectSourceKind(entryPath);
  return `${path.basename(entryPath, extensionForSourceKind(sourceKind))}-${hashContent(entryPath).slice(0, 8)}`;
}

function normalizeImportedScene(
  scene: SceneSpec,
  importSource: ImportedScene['importSource'],
  options: PrepareSceneOptions,
): SceneSpec {
  let normalized = pruneEmptySceneSections(scene);
  if (
    (importSource === 'strudel' || importSource === 'tidal') &&
    normalized.samples.length === 0 &&
    sceneUsesDefaultStrudelSamples(normalized)
  ) {
    normalized = {
      ...normalized,
      samples: [{ ref: DEFAULT_STRUDEL_SAMPLE_PACK }],
    };
  }

  if (importSource !== 'strudel') {
    return normalized;
  }

  const channelNames = Object.keys(normalized.channels);
  if (channelNames.length === 1 && channelNames[0] === 'main') {
    const main = normalized.channels.main;
    if (!main) {
      return normalized;
    }
    return {
      ...normalized,
      channels: { [options.entry ?? 'd1']: main },
    };
  }

  if (channelNames.length > 0 && channelNames.every((name, index) => name === `layer${index + 1}`)) {
    return {
      ...normalized,
      channels: Object.fromEntries(
        channelNames.flatMap((name, index) => {
          const channel = normalized.channels[name];
          return channel ? [[`d${index + 1}`, channel]] : [];
        }),
      ),
    };
  }

  return normalized;
}

function sceneUsesDefaultStrudelSamples(scene: SceneSpec): boolean {
  return Object.values(scene.channels).some((channel) => valueUsesDefaultStrudelSamples(channel.node));
}

function valueUsesDefaultStrudelSamples(value: unknown): boolean {
  if (typeof value === 'string') {
    return DEFAULT_STRUDEL_SAMPLE_NAMES.some((name) =>
      new RegExp(`(^|[^A-Za-z])${name}([^A-Za-z]|$)`).test(value),
    );
  }

  if (Array.isArray(value)) {
    return value.some((entry) => valueUsesDefaultStrudelSamples(entry));
  }

  if (isExpressionNode(value)) {
    if (
      (value.kind === 'call' && (value.name === 's' || value.name === 'sound')) ||
      (value.kind === 'method' && (value.name === 's' || value.name === 'sound'))
    ) {
      return value.args.some((entry) => valueUsesDefaultStrudelSamples(entry));
    }

    const nested = value.kind === 'method' ? [value.target, ...value.args] : value.args;
    return nested.some((entry) => valueUsesDefaultStrudelSamples(entry));
  }

  if (isPlainObject(value)) {
    return Object.entries(value).some(
      ([key, entry]) =>
        ((key === 's' || key === 'sound') && valueUsesDefaultStrudelSamples(entry)) ||
        valueUsesDefaultStrudelSamples(entry),
    );
  }

  return false;
}

function pruneEmptySceneSections(scene: SceneSpec): SceneSpec {
  const next: SceneSpec = {
    channels: scene.channels,
    samples: scene.samples,
    transport: scene.transport,
  };

  if (scene.master && Object.keys(scene.master).length > 0) {
    next.master = scene.master;
  }
  if (scene.metadata && Object.keys(scene.metadata).length > 0) {
    next.metadata = scene.metadata;
  }

  return next;
}

function hashContent(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

function detectSourceKind(entryPath: string): SourceKind {
  if (entryPath.endsWith('.script.ts')) {
    return 'script-ts';
  }
  if (entryPath.endsWith('.scene.ts')) {
    return 'scene-ts';
  }
  if (entryPath.endsWith('.scene.json')) {
    return 'scene-json';
  }
  if (entryPath.endsWith('.strudel.ts')) {
    return 'strudel-ts';
  }
  if (entryPath.endsWith('.strudel.js')) {
    return 'strudel-js';
  }
  if (entryPath.endsWith('.strudel.mjs')) {
    return 'strudel-mjs';
  }
  if (entryPath.endsWith('.tidal')) {
    return 'tidal';
  }
  throw new Error(`Unsupported entry type for ${entryPath}`);
}

function createRootReferenceExpression(rootEntry: string): ts.Expression {
  if (/^[A-Za-z_$][\w$]*$/.test(rootEntry)) {
    return ts.factory.createIdentifier(rootEntry);
  }
  return ts.factory.createElementAccessExpression(
    ts.factory.createIdentifier('globalThis'),
    ts.factory.createStringLiteral(rootEntry),
  );
}

function transformScriptToSceneModule(
  source: string,
  metadata: MetadataSpec,
  entryPath: string,
  generatedPath: string,
  options: {
    rootEntry?: string;
    scriptKind: ts.ScriptKind;
    strictRootSelection?: boolean;
  },
): string {
  const sourceFile = ts.createSourceFile(entryPath, source, ts.ScriptTarget.Latest, true, options.scriptKind);
  const rootExpressionIndex = resolveRootExpressionIndex(sourceFile, options);

  if (rootExpressionIndex === undefined && !options.rootEntry) {
    throw new Error('Script files must end with a bare expression to become the live root');
  }

  const factory = ts.factory;
  const recorderImport = factory.createImportDeclaration(
    undefined,
    factory.createImportClause(
      false,
      undefined,
      factory.createNamespaceImport(factory.createIdentifier('__tusselDsl')),
    ),
    factory.createStringLiteral('@tussel/dsl'),
  );

  const dslBindings = factory.createVariableStatement(
    undefined,
    factory.createVariableDeclarationList(
      [
        factory.createVariableDeclaration(
          factory.createObjectBindingPattern([
            factory.createBindingElement(undefined, undefined, factory.createIdentifier('__tusselRecorder')),
          ]),
          undefined,
          undefined,
          factory.createIdentifier('__tusselDsl'),
        ),
      ],
      ts.NodeFlags.Const,
    ),
  );

  const exposeGlobals = factory.createExpressionStatement(
    factory.createCallExpression(
      factory.createPropertyAccessExpression(factory.createIdentifier('Object'), 'assign'),
      undefined,
      [factory.createIdentifier('globalThis'), factory.createIdentifier('__tusselDsl')],
    ),
  );

  const beginCall = factory.createExpressionStatement(
    factory.createCallExpression(
      factory.createPropertyAccessExpression(factory.createIdentifier('__tusselRecorder'), 'beginModule'),
      undefined,
      [tsJsonToExpression(metadata)],
    ),
  );

  const statements = sourceFile.statements.map((statement, index) => {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      ts.isExternalModuleNameRelative(statement.moduleSpecifier.text)
    ) {
      return factory.updateImportDeclaration(
        statement,
        statement.modifiers,
        statement.importClause,
        factory.createStringLiteral(
          rewriteRelativeSpecifier(entryPath, generatedPath, statement.moduleSpecifier.text),
        ),
        statement.attributes,
      );
    }

    if (index !== rootExpressionIndex || !ts.isExpressionStatement(statement)) {
      return statement;
    }

    return factory.createExpressionStatement(
      factory.createCallExpression(
        factory.createPropertyAccessExpression(factory.createIdentifier('__tusselRecorder'), 'setRoot'),
        undefined,
        [statement.expression],
      ),
    );
  });

  if (rootExpressionIndex === undefined && options.rootEntry) {
    statements.push(
      factory.createExpressionStatement(
        factory.createCallExpression(
          factory.createPropertyAccessExpression(factory.createIdentifier('__tusselRecorder'), 'setRoot'),
          undefined,
          [createRootReferenceExpression(options.rootEntry)],
        ),
      ),
    );
  }

  const exportDefault = factory.createExportAssignment(
    undefined,
    false,
    factory.createCallExpression(
      factory.createPropertyAccessExpression(factory.createIdentifier('__tusselRecorder'), 'finalize'),
      undefined,
      [],
    ),
  );

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const generated = factory.updateSourceFile(sourceFile, [
    recorderImport,
    dslBindings,
    exposeGlobals,
    beginCall,
    ...statements,
    exportDefault,
  ]);
  return printer.printFile(generated);
}

function resolveRootExpressionIndex(
  sourceFile: ts.SourceFile,
  options: {
    rootEntry?: string;
    strictRootSelection?: boolean;
  },
): number | undefined {
  if (options.rootEntry) {
    return undefined;
  }

  const expressionIndexes = sourceFile.statements.flatMap((statement, index) =>
    ts.isExpressionStatement(statement) ? [index] : [],
  );

  const candidateIndexes = expressionIndexes.filter((index) => {
    const statement = sourceFile.statements[index];
    return (
      !!statement && ts.isExpressionStatement(statement) && isRootCandidateExpression(statement.expression)
    );
  });

  if (options.strictRootSelection) {
    if (candidateIndexes.length === 0) {
      return undefined;
    }
    if (candidateIndexes.length > 1) {
      throw new Error('Ambiguous external script root. Pass --entry <binding-or-root> to select a binding.');
    }
    return candidateIndexes[0];
  }

  return candidateIndexes.at(-1);
}

function isRootCandidateExpression(expression: ts.Expression): boolean {
  return resolveSetupExpressionName(expression) === undefined;
}

function resolveSetupExpressionName(expression: ts.Expression): string | undefined {
  if (ts.isAwaitExpression(expression)) {
    return resolveSetupExpressionName(expression.expression);
  }

  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
    return SETUP_CALL_NAMES.has(expression.expression.text) ? expression.expression.text : undefined;
  }

  if (ts.isTaggedTemplateExpression(expression) && ts.isIdentifier(expression.tag)) {
    return SETUP_CALL_NAMES.has(expression.tag.text) ? expression.tag.text : undefined;
  }

  return undefined;
}

function rewriteRelativeSpecifier(entryPath: string, generatedPath: string, specifier: string): string {
  const resolvedPath = path.resolve(path.dirname(entryPath), specifier);
  return relativeModuleSpecifier(generatedPath, resolvedPath);
}

function tsJsonToExpression(value: unknown): ts.Expression {
  if (value === null) {
    return ts.factory.createNull();
  }
  if (typeof value === 'string') {
    return ts.factory.createStringLiteral(value);
  }
  if (typeof value === 'number') {
    return ts.factory.createNumericLiteral(value);
  }
  if (typeof value === 'boolean') {
    return value ? ts.factory.createTrue() : ts.factory.createFalse();
  }
  if (Array.isArray(value)) {
    return ts.factory.createArrayLiteralExpression(value.map((entry) => tsJsonToExpression(entry)));
  }
  return ts.factory.createObjectLiteralExpression(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) =>
      ts.factory.createPropertyAssignment(key, tsJsonToExpression(entry)),
    ),
    true,
  );
}

function parseMetadata(source: string): MetadataSpec {
  const metadata: MetadataSpec = {};
  const lines = source.split('\n').map((line) => line.trim());
  const headerLines = lines.filter((line) => line.startsWith('//'));
  for (const line of headerLines) {
    const stripped = line.replace(/^\/\/\s?/, '');
    if (stripped.startsWith('"')) {
      const titleMatch = /^"([^"]+)"/.exec(stripped);
      if (titleMatch?.[1]) {
        metadata.title = titleMatch[1];
      }
    }
    const tags = stripped.matchAll(/@([a-zA-Z][\w-]*)\s+([^@]+)/g);
    for (const tag of tags) {
      const key = tag[1];
      const rawValue = tag[2];
      if (!key || !rawValue) {
        continue;
      }
      const value = rawValue.trim();
      const existing = metadata[key];
      if (existing === undefined) {
        metadata[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        metadata[key] = [existing, value];
      }
    }
  }
  return metadata;
}

function renderSceneModule(scene: SceneSpec): string {
  const imports = collectDslImports(scene);
  const customParams = [...collectCustomParamNames(scene)].sort();
  if (customParams.length === 1) {
    imports.add('createParam');
  } else if (customParams.length > 1) {
    imports.add('createParams');
  }
  const prelude = renderCustomParamPrelude(customParams);
  return `import { ${[...imports].sort().join(', ')} } from '@tussel/dsl';\n\n${prelude ? `${prelude}\n\n` : ''}export default defineScene(${renderValue(scene)});\n`;
}

function renderScriptModule(scene: SceneSpec): string {
  const lines: string[] = [];
  const customParams = [...collectCustomParamNames(scene)].sort();
  const hydra = extractHydraMetadata(scene);

  const title = scene.metadata?.title;
  if (typeof title === 'string') {
    lines.push(`// ${JSON.stringify(title)}`);
  }
  for (const [key, value] of Object.entries(scene.metadata ?? {})) {
    if (key === 'title' || key === 'hydra') {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        lines.push(`// @${key} ${entry}`);
      }
      continue;
    }
    lines.push(`// @${key} ${String(value)}`);
  }

  for (const sample of scene.samples) {
    lines.push(`samples(${JSON.stringify(sample.ref)});`);
  }

  if (scene.transport.cps !== undefined) {
    lines.push(`setcps(${renderValue(scene.transport.cps)});`);
  }

  if (scene.transport.bpm !== undefined) {
    lines.push(`setbpm(${renderValue(scene.transport.bpm)});`);
  }

  if (hydra) {
    lines.push(`await initHydra(${renderValue(hydra.options)});`);
    for (const program of hydra.programs) {
      lines.push(`hydra(${JSON.stringify(program.code)});`);
    }
  }

  const customPrelude = renderCustomParamPrelude(customParams);
  if (customPrelude) {
    lines.push(customPrelude);
  }

  const sceneValue = {
    channels: scene.channels,
    master: scene.master,
  };
  lines.push('');
  lines.push(`scene(${renderValue(sceneValue)});`);
  return `${lines.join('\n')}\n`;
}

export function renderHydraModule(scene: SceneSpec): string | undefined {
  const hydra = extractHydraMetadata(scene);
  if (!hydra) {
    return undefined;
  }

  return `export const hydraOptions = ${renderValue(hydra.options)};\nexport const hydraPrograms = ${JSON.stringify(
    hydra.programs.map((program) => program.code),
    null,
    2,
  )};\n\nexport default async function runHydra(scope = globalThis) {\n  const init = typeof scope.initHydra === 'function' ? scope.initHydra : async () => hydraOptions;\n  const apply = typeof scope.hydra === 'function' ? scope.hydra : (code) => code;\n  await init(hydraOptions);\n  for (const code of hydraPrograms) {\n    apply(code);\n  }\n  return { options: hydraOptions, programs: hydraPrograms };\n}\n`;
}

async function writeHydraArtifactForScene(scene: SceneSpec, outputPath: string): Promise<string | undefined> {
  const hydraModule = renderHydraModule(scene);
  if (!hydraModule) {
    return undefined;
  }

  await writeFile(outputPath, hydraModule);
  return outputPath;
}

function extractHydraMetadata(scene: SceneSpec): HydraSceneSpec | undefined {
  return normalizeHydraSceneSpec(scene.metadata?.hydra);
}

function relativeModuleSpecifier(fromPath: string, toPath: string): string {
  const relative = path.relative(path.dirname(fromPath), toPath).replaceAll(path.sep, '/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function withTsNoCheck(source: string): string {
  return source.startsWith('// @ts-nocheck') ? source : `// @ts-nocheck\n${source}`;
}

function renderCustomParamPrelude(names: string[]): string | undefined {
  if (names.length === 0) {
    return undefined;
  }
  if (names.length === 1) {
    return `const ${names[0]} = createParam(${JSON.stringify(names[0])});`;
  }
  return `const { ${names.join(', ')} } = createParams(${names.map((name) => JSON.stringify(name)).join(', ')});`;
}

const BUILTIN_DSL_CALLS = new Set([
  'H',
  'cat',
  'cc',
  'chord',
  'clearHydra',
  'contract',
  'cosine',
  'csound',
  'csoundm',
  'defineScene',
  'drop',
  'expand',
  'extend',
  'fast',
  'gamepad',
  'grow',
  'hydra',
  'initHydra',
  'input',
  'midi',
  'motion',
  'n',
  'note',
  'pace',
  'perlin',
  'ply',
  'rand',
  's',
  'saw',
  'scene',
  'seq',
  'silence',
  'sine',
  'slow',
  'sound',
  'square',
  'stack',
  'stepalt',
  'stepcat',
  'take',
  'tri',
  'triangle',
  'value',
  'zip',
]);

const BUILTIN_PATTERN_METHODS = new Set([
  'add',
  'anchor',
  'attack',
  'bank',
  'begin',
  'ceil',
  'chunk',
  'csound',
  'csoundm',
  'clip',
  'compress',
  'contract',
  'color',
  'cut',
  'cutoff',
  'decay',
  'delay',
  'dict',
  'div',
  'drop',
  'early',
  'end',
  'expand',
  'extend',
  'fast',
  'fastGap',
  'floor',
  'fm',
  'gain',
  'hcutoff',
  'hpf',
  'hurry',
  'late',
  'linger',
  'log',
  'loop',
  'lpf',
  'lpq',
  'mask',
  'mode',
  'mul',
  'note',
  'offset',
  'orbit',
  'pace',
  'pan',
  'phaser',
  'ply',
  'punchcard',
  'range',
  'rarely',
  'rev',
  'rootNotes',
  'room',
  'round',
  's',
  'scramble',
  'scale',
  'scaleTranspose',
  'segment',
  'set',
  'shape',
  'shuffle',
  'shrink',
  'size',
  'slow',
  'slowGap',
  'sound',
  'speed',
  'struct',
  'sub',
  'sustain',
  'take',
  'tour',
  'transpose',
  'voicing',
  'voicings',
  'zoom',
  '_punchcard',
  '_scope',
]);

function collectDslImports(value: unknown, imports = new Set<string>(['defineScene'])): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectDslImports(entry, imports);
    }
    return imports;
  }

  if (isExpressionNode(value)) {
    if (value.kind === 'call') {
      if (BUILTIN_DSL_CALLS.has(value.name)) {
        imports.add(value.name);
      }
      for (const entry of value.args) {
        collectDslImports(entry, imports);
      }
      return imports;
    }

    collectDslImports(value.target, imports);
    for (const entry of value.args) {
      collectDslImports(entry, imports);
    }
    return imports;
  }

  if (isPlainObject(value)) {
    for (const entry of Object.values(value)) {
      collectDslImports(entry, imports);
    }
  }

  return imports;
}

function collectCustomParamNames(value: unknown, names = new Set<string>()): Set<string> {
  return collectCustomParamNamesFromIR(value, BUILTIN_DSL_CALLS, BUILTIN_PATTERN_METHODS, names);
}

function typecheckFile(filePath: string): readonly ts.Diagnostic[] {
  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    throw new Error('Unable to locate tsconfig.json');
  }
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
  const rootNames = [...new Set([...parsed.fileNames, filePath])];
  const program = ts.createProgram({
    options: parsed.options,
    rootNames,
  });
  return ts.getPreEmitDiagnostics(program);
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  const host: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (value) => value,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  };
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, host);
}

async function executeSceneModule(modulePath: string): Promise<SceneSpec> {
  const bundlePath = path.join(
    path.resolve('.tussel-cache', 'bundled'),
    `${path.basename(modulePath, '.ts')}.bundle.mjs`,
  );
  await mkdir(path.dirname(bundlePath), { recursive: true });
  await esbuild({
    absWorkingDir: process.cwd(),
    bundle: true,
    entryPoints: [modulePath],
    format: 'esm',
    outfile: bundlePath,
    platform: 'node',
    plugins: [workspaceAliasPlugin],
    sourcemap: 'inline',
    target: 'node20',
  });
  const restoreGlobals = snapshotDslGlobals();
  tusselDsl.installStringPrototypeExtensions();
  try {
    const loaded = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`);
    return loaded.default as SceneSpec;
  } finally {
    tusselDsl.uninstallStringPrototypeExtensions();
    restoreGlobals();
  }
}

function snapshotDslGlobals(): () => void {
  const previous = new Map<string, { existed: boolean; value: unknown }>();
  for (const [key, value] of Object.entries(tusselDsl)) {
    previous.set(key, {
      existed: Object.hasOwn(globalThis, key),
      value: (globalThis as Record<string, unknown>)[key],
    });
    (globalThis as Record<string, unknown>)[key] = value;
  }

  return () => {
    for (const [key, snapshot] of previous) {
      if (snapshot.existed) {
        (globalThis as Record<string, unknown>)[key] = snapshot.value;
      } else {
        delete (globalThis as Record<string, unknown>)[key];
      }
    }
  };
}

async function collectDependencies(entryPath: string): Promise<string[]> {
  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    return [entryPath];
  }
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
  const seen = new Set<string>();

  const visit = async (filePath: string): Promise<void> => {
    const absolute = path.resolve(filePath);
    if (seen.has(absolute)) {
      return;
    }
    seen.add(absolute);

    if (absolute.endsWith('.scene.json') || absolute.endsWith('.tidal')) {
      return;
    }

    const source = await readFile(absolute, 'utf8');
    const sourceFile = ts.createSourceFile(absolute, source, ts.ScriptTarget.Latest, true);
    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !statement.moduleSpecifier ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }

      const specifier = statement.moduleSpecifier.text;
      const resolved = ts.resolveModuleName(specifier, absolute, parsed.options, ts.sys).resolvedModule;
      if (resolved?.resolvedFileName) {
        await visit(resolved.resolvedFileName);
      }
    }
  };

  await visit(entryPath);
  return [...seen];
}

async function watchDependencies(pathsToWatch: string[], reload: () => Promise<void>): Promise<FSWatcher> {
  let timeout: NodeJS.Timeout | undefined;
  const watcher = chokidar.watch(pathsToWatch, { ignoreInitial: true });
  watcher.on('all', () => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      void reload();
    }, 100);
  });
  return watcher;
}

function printSuccess(prepared: PreparedScene): void {
  const channels = Object.keys(prepared.scene.channels).length;
  console.log(
    pc.green(
      `Loaded ${prepared.kind} with ${channels} channel${channels === 1 ? '' : 's'} from ${prepared.generatedPath}`,
    ),
  );
}
