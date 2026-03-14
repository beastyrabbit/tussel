import {
  assertSceneSpec,
  type ChannelSpec,
  cloneExpressionValue,
  createCallExpression,
  createMethodExpression,
  type ExpressionNode,
  type ExpressionValue,
  type ExprType,
  type HydraSceneSpec,
  type SceneInput as IRSceneInput,
  isExpressionNode,
  isPlainObject,
  type MetadataSpec,
  normalizeChannelSpec,
  normalizeHydraSceneSpec,
  normalizeSampleSource,
  renderHydraTemplate,
  renderValue,
  type SampleSourceSpec,
  type SceneSpec,
  type TransportSpec,
  TusselHydraError,
} from '@tussel/ir';

export * from '@tussel/ir';

const BUILDER = Symbol.for('tussel.builder');
type BuilderKind = 'pattern' | 'signal';

interface BuilderState<TKind extends BuilderKind> {
  [BUILDER]: true;
  expr: ExpressionNode;
  kind: TKind;
}

type BuilderLike = BuilderState<BuilderKind>;

export type StructuralValue =
  | BuilderLike
  | ExpressionValue
  | StructuralValue[]
  | { [key: string]: StructuralValue };

export interface SceneInput {
  channels?: Record<string, ChannelSpec | StructuralValue>;
  master?: SceneSpec['master'];
  metadata?: MetadataSpec;
  root?: StructuralValue;
  samples?: Array<SampleSourceSpec | string>;
  transport?: TransportSpec;
}

function isBuilderLike(value: unknown): value is BuilderLike {
  return (
    isPlainObject(value) &&
    BUILDER in value &&
    value[BUILDER as keyof typeof value] === true &&
    isExpressionNode(value.expr)
  );
}

function normalizeValue(value: unknown): ExpressionValue {
  if (isBuilderLike(value)) {
    return cloneExpressionValue(value.expr);
  }

  if (isExpressionNode(value)) {
    return cloneExpressionValue(value);
  }

  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry)]),
    ) as ExpressionValue;
  }

  throw new Error(`Unsupported structural value: ${String(value)}`);
}

class BaseBuilder<TKind extends BuilderKind> implements BuilderState<TKind> {
  [BUILDER] = true as const;
  constructor(
    public readonly kind: TKind,
    public readonly expr: ExpressionNode,
  ) {}

  protected wrap(kind: TKind, expr: ExpressionNode): BuilderFor<TKind> {
    return createBuilder(kind, expr);
  }

  protected method(name: string, args: unknown[]): BuilderFor<TKind> {
    return this.wrap(
      this.kind,
      createMethodExpression(
        this.expr,
        name,
        args.map((entry) => normalizeValue(entry)),
        this.kind,
      ),
    );
  }

  toJSON(): ExpressionNode {
    return this.expr;
  }

  show(): string {
    return renderValue(this.expr);
  }
}

export class PatternBuilder extends BaseBuilder<'pattern'> {
  add(value: unknown): PatternBuilder {
    return this.method('add', [value]);
  }

  anchor(value: unknown): PatternBuilder {
    return this.method('anchor', [value]);
  }

  attack(value: unknown): PatternBuilder {
    return this.method('attack', [value]);
  }

  bank(value: unknown): PatternBuilder {
    return this.method('bank', [value]);
  }

  ceil(): PatternBuilder {
    return this.method('ceil', []);
  }

  begin(value: unknown): PatternBuilder {
    return this.method('begin', [value]);
  }

  chunk(size: unknown, transform: unknown): PatternBuilder {
    return this.method('chunk', [size, normalizePatternTransform(this, transform)]);
  }

  clip(value: unknown): PatternBuilder {
    return this.method('clip', [value]);
  }

  compress(begin: unknown, end: unknown): PatternBuilder {
    return this.method('compress', [begin, end]);
  }

  cut(value: unknown): PatternBuilder {
    return this.method('cut', [value]);
  }

  cutoff(value: unknown): PatternBuilder {
    return this.method('cutoff', [value]);
  }

  decay(value: unknown): PatternBuilder {
    return this.method('decay', [value]);
  }

  contract(value: unknown): PatternBuilder {
    return this.method('contract', [value]);
  }

  csound(value: unknown): PatternBuilder {
    return this.method('csound', [value]);
  }

  csoundm(value: unknown): PatternBuilder {
    return this.method('csoundm', [value]);
  }

  delay(value: unknown): PatternBuilder {
    return this.method('delay', [value]);
  }

  dict(value: unknown): PatternBuilder {
    return this.method('dict', [value]);
  }

  div(value: unknown): PatternBuilder {
    return this.method('div', [value]);
  }

  drop(value: unknown): PatternBuilder {
    return this.method('drop', [value]);
  }

  early(value: unknown): PatternBuilder {
    return this.method('early', [value]);
  }

  edo(value: unknown): PatternBuilder {
    return this.method('edo', [value]);
  }

  end(value: unknown): PatternBuilder {
    return this.method('end', [value]);
  }

  expand(value: unknown): PatternBuilder {
    return this.method('expand', [value]);
  }

  extend(value: unknown): PatternBuilder {
    return this.method('extend', [value]);
  }

  floor(): PatternBuilder {
    return this.method('floor', []);
  }

  fast(value: unknown): PatternBuilder {
    return this.method('fast', [value]);
  }

  fastGap(value: unknown): PatternBuilder {
    return this.method('fastGap', [value]);
  }

  fm(value: unknown): PatternBuilder {
    return this.method('fm', [value]);
  }

  gain(value: unknown): PatternBuilder {
    return this.method('gain', [value]);
  }

  grow(value: unknown): PatternBuilder {
    return this.method('grow', [value]);
  }

  hpf(value: unknown): PatternBuilder {
    return this.method('hpf', [value]);
  }

  hcutoff(value: unknown): PatternBuilder {
    return this.method('hcutoff', [value]);
  }

  late(value: unknown): PatternBuilder {
    return this.method('late', [value]);
  }

  hurry(value: unknown): PatternBuilder {
    return this.method('hurry', [value]);
  }

  almostAlways(transform: unknown): PatternBuilder {
    return this.sometimesBy(0.9, transform);
  }

  almostNever(transform: unknown): PatternBuilder {
    return this.sometimesBy(0.1, transform);
  }

  log(): PatternBuilder {
    console.log(this.show());
    return this;
  }

  lpf(value: unknown): PatternBuilder {
    return this.method('lpf', [value]);
  }

  linger(value: unknown): PatternBuilder {
    return this.method('linger', [value]);
  }

  lpq(value: unknown): PatternBuilder {
    return this.method('lpq', [value]);
  }

  loop(value: unknown = true): PatternBuilder {
    return this.method('loop', [value]);
  }

  layer(...transforms: unknown[]): PatternBuilder {
    return stack(...transforms.map((transform) => applyPatternTransform(this, transform)));
  }

  mask(value: unknown): PatternBuilder {
    return this.method('mask', [value]);
  }

  mode(value: unknown): PatternBuilder {
    return this.method('mode', [value]);
  }

  mul(value: unknown): PatternBuilder {
    return this.method('mul', [value]);
  }

  n(value: unknown): PatternBuilder {
    return this.method('n', [value]);
  }

  note(value?: unknown): PatternBuilder {
    return this.method('note', value === undefined ? [] : [value]);
  }

  midichan(value: unknown): PatternBuilder {
    return this.method('midichan', [value]);
  }

  midicc(value: unknown): PatternBuilder {
    return this.method('midicc', [value]);
  }

  midiport(value: unknown): PatternBuilder {
    return this.method('midiport', [value]);
  }

  midivalue(value: unknown): PatternBuilder {
    return this.method('midivalue', [value]);
  }

  off(time: unknown, transform: unknown): PatternBuilder {
    return stack(this, applyPatternTransform(this, transform).late(time));
  }

  often(transform: unknown): PatternBuilder {
    return this.sometimesBy(0.75, transform);
  }

  offset(value: unknown): PatternBuilder {
    return this.method('offset', [value]);
  }

  orbit(value: unknown): PatternBuilder {
    return this.method('orbit', [value]);
  }

  osc(value: unknown): PatternBuilder {
    return this.method('osc', [value]);
  }

  oschost(value: unknown): PatternBuilder {
    return this.method('oschost', [value]);
  }

  oscport(value: unknown): PatternBuilder {
    return this.method('oscport', [value]);
  }

  pace(value: unknown): PatternBuilder {
    return this.method('pace', [value]);
  }

  pan(value: unknown): PatternBuilder {
    return this.method('pan', [value]);
  }

  phaser(value: unknown): PatternBuilder {
    return this.method('phaser', [value]);
  }

  ply(value: unknown): PatternBuilder {
    return this.method('ply', [value]);
  }

  degrade(): PatternBuilder {
    return this.method('degrade', []);
  }

  degradeBy(value: unknown): PatternBuilder {
    return this.method('degradeBy', [value]);
  }

  every(value: unknown, transform: unknown): PatternBuilder {
    return this.method('every', [value, normalizePatternTransform(this, transform)]);
  }

  jux(transform: unknown): PatternBuilder {
    return this.juxBy(1, transform);
  }

  juxBy(value: unknown, transform: unknown): PatternBuilder {
    return stack(this.pan(mirrorPanValue(value)), applyPatternTransform(this, transform).pan(value));
  }

  rarely(value?: unknown): PatternBuilder {
    if (typeof value === 'function') {
      return this.sometimesBy(0.25, value);
    }
    return this.method('rarely', value === undefined ? [] : [value]);
  }

  rev(): PatternBuilder {
    return this.method('rev', []);
  }

  round(): PatternBuilder {
    return this.method('round', []);
  }

  release(value: unknown): PatternBuilder {
    return this.method('release', [value]);
  }

  room(value: unknown): PatternBuilder {
    return this.method('room', [value]);
  }

  scramble(value: unknown): PatternBuilder {
    return this.method('scramble', [value]);
  }

  scale(value: unknown): PatternBuilder {
    return this.method('scale', [value]);
  }

  scaleTranspose(value: unknown): PatternBuilder {
    return this.method('scaleTranspose', [value]);
  }

  s(value?: unknown): PatternBuilder {
    return this.method('s', value === undefined ? [] : [value]);
  }

  segment(value: unknown): PatternBuilder {
    return this.method('segment', [value]);
  }

  set(value: unknown): PatternBuilder {
    return this.method('set', [value]);
  }

  shape(value: unknown): PatternBuilder {
    return this.method('shape', [value]);
  }

  shuffle(value: unknown): PatternBuilder {
    return this.method('shuffle', [value]);
  }

  size(value: unknown): PatternBuilder {
    return this.method('size', [value]);
  }

  slow(value: unknown): PatternBuilder {
    return this.method('slow', [value]);
  }

  slowGap(value: unknown): PatternBuilder {
    return this.method('slowGap', [value]);
  }

  sometimes(transform: unknown): PatternBuilder {
    return this.sometimesBy(0.5, transform);
  }

  sometimesBy(value: unknown, transform: unknown): PatternBuilder {
    return this.method('sometimesBy', [value, normalizePatternTransform(this, transform)]);
  }

  sound(value?: unknown): PatternBuilder {
    return this.method('sound', value === undefined ? [] : [value]);
  }

  speed(value: unknown): PatternBuilder {
    return this.method('speed', [value]);
  }

  struct(value: unknown): PatternBuilder {
    return this.method('struct', [value]);
  }

  sub(value: unknown): PatternBuilder {
    return this.method('sub', [value]);
  }

  transpose(value: unknown): PatternBuilder {
    return this.method('transpose', [value]);
  }

  sustain(value: unknown): PatternBuilder {
    return this.method('sustain', [value]);
  }

  velocity(value: unknown): PatternBuilder {
    return this.method('velocity', [value]);
  }

  superimpose(...transforms: unknown[]): PatternBuilder {
    return stack(this, ...transforms.map((transform) => applyPatternTransform(this, transform)));
  }

  shrink(value: unknown): PatternBuilder {
    return this.method('shrink', [value]);
  }

  take(value: unknown): PatternBuilder {
    return this.method('take', [value]);
  }

  tour(...values: unknown[]): PatternBuilder {
    return this.method('tour', values);
  }

  when(value: unknown, transform: unknown): PatternBuilder {
    return this.method('when', [value, normalizePatternTransform(this, transform)]);
  }

  within(begin: unknown, end: unknown, transform: unknown): PatternBuilder {
    return this.method('within', [begin, end, normalizePatternTransform(this, transform)]);
  }

  zoom(begin: unknown, end: unknown): PatternBuilder {
    return this.method('zoom', [begin, end]);
  }

  rootNotes(value: unknown = 2): PatternBuilder {
    return this.method('rootNotes', [value]);
  }

  voicing(): PatternBuilder {
    return this.method('voicing', []);
  }

  voicings(value: unknown): PatternBuilder {
    return this.dict(value).voicing();
  }
}

export class SignalBuilder extends BaseBuilder<'signal'> {
  add(value: unknown): SignalBuilder {
    return this.method('add', [value]);
  }

  div(value: unknown): SignalBuilder {
    return this.method('div', [value]);
  }

  early(value: unknown): SignalBuilder {
    return this.method('early', [value]);
  }

  fast(value: unknown): SignalBuilder {
    return this.method('fast', [value]);
  }

  late(value: unknown): SignalBuilder {
    return this.method('late', [value]);
  }

  mul(value: unknown): SignalBuilder {
    return this.method('mul', [value]);
  }

  range(min: unknown, max: unknown): SignalBuilder {
    return this.method('range', [min, max]);
  }

  segment(value: unknown): SignalBuilder {
    return this.method('segment', [value]);
  }

  slow(value: unknown): SignalBuilder {
    return this.method('slow', [value]);
  }

  sub(value: unknown): SignalBuilder {
    return this.method('sub', [value]);
  }
}

type BuilderFor<TKind extends BuilderKind> = TKind extends 'pattern' ? PatternBuilder : SignalBuilder;

function createBuilder<TKind extends BuilderKind>(kind: TKind, expr: ExpressionNode): BuilderFor<TKind> {
  return (
    kind === 'pattern' ? new PatternBuilder(kind, expr) : new SignalBuilder(kind, expr)
  ) as BuilderFor<TKind>;
}

function normalizePatternTransform(target: PatternBuilder, transform: unknown): ExpressionValue {
  if (typeof transform === 'function') {
    return normalizeValue(transform(target));
  }
  return normalizeValue(transform);
}

function applyPatternTransform(target: PatternBuilder, transform: unknown): PatternBuilder {
  return toPatternBuilder(normalizePatternTransform(target, transform));
}

function toPatternBuilder(value: unknown): PatternBuilder {
  const normalized = normalizeValue(value);
  if (!isExpressionNode(normalized) || normalized.exprType !== 'pattern') {
    throw new Error('Pattern transform must return a pattern expression');
  }
  return createBuilder('pattern', normalized);
}

function mirrorPanValue(value: unknown): unknown {
  if (typeof value === 'number') {
    return -value;
  }
  if (typeof value === 'string') {
    const numeric = Number(value.trim());
    if (Number.isFinite(numeric)) {
      return -numeric;
    }
  }
  return value;
}

type PatternTransform = (pattern: PatternBuilder) => PatternBuilder;

function createPatternTransform(name: string): (...args: unknown[]) => PatternTransform {
  return (...args: unknown[]) =>
    (pattern: PatternBuilder) =>
      createBuilder(
        'pattern',
        createMethodExpression(
          pattern.expr,
          name,
          args.map((entry) => normalizeValue(entry)),
          'pattern',
        ),
      );
}

const createPatternTransformFactory = createPatternTransform;
const fastTransform = createPatternTransformFactory('fast');
const slowTransform = createPatternTransformFactory('slow');
const plyTransform = createPatternTransformFactory('ply');
const addTransform = createPatternTransformFactory('add');
const compressTransform = createPatternTransformFactory('compress');
const contractTransform = createPatternTransformFactory('contract');
const subTransform = createPatternTransformFactory('sub');
const mulTransform = createPatternTransformFactory('mul');
const divTransform = createPatternTransformFactory('div');
const dropTransform = createPatternTransformFactory('drop');
const earlyTransform = createPatternTransformFactory('early');
const expandTransform = createPatternTransformFactory('expand');
const extendTransform = createPatternTransformFactory('extend');
const fastGapTransform = createPatternTransformFactory('fastGap');
const growTransform = createPatternTransformFactory('grow');
const hurryTransform = createPatternTransformFactory('hurry');
const lateTransform = createPatternTransformFactory('late');
const lingerTransform = createPatternTransformFactory('linger');
const paceTransform = createPatternTransformFactory('pace');
const revTransform = createPatternTransformFactory('rev')();
const slowGapTransform = createPatternTransformFactory('slowGap');
const scrambleTransform = createPatternTransformFactory('scramble');
const shuffleTransform = createPatternTransformFactory('shuffle');
const shrinkTransform = createPatternTransformFactory('shrink');
const takeTransform = createPatternTransformFactory('take');
const zoomTransform = createPatternTransformFactory('zoom');

export function expr(name: string, args: unknown[] = [], exprType: ExprType = 'value'): ExpressionNode {
  return createCallExpression(
    name,
    args.map((entry) => normalizeValue(entry)),
    exprType,
  );
}

function patternCall(name: string, args: unknown[] = []): PatternBuilder {
  return createBuilder('pattern', expr(name, args, 'pattern'));
}

function signalCall(name: string, args: unknown[] = []): SignalBuilder {
  return createBuilder('signal', expr(name, args, 'signal'));
}

export function stack(...nodes: unknown[]): PatternBuilder {
  return patternCall('stack', nodes);
}

export function cat(...nodes: unknown[]): PatternBuilder {
  return patternCall('cat', nodes);
}

export function seq(...nodes: unknown[]): PatternBuilder {
  return patternCall('seq', nodes);
}

export function sequence(...nodes: unknown[]): PatternBuilder {
  return patternCall('sequence', nodes);
}

export function choose(...nodes: unknown[]): PatternBuilder {
  return patternCall('choose', nodes);
}

export function wchoose(...nodes: unknown[]): PatternBuilder {
  return patternCall('wchoose', nodes);
}

export function stepcat(...nodes: unknown[]): PatternBuilder {
  return patternCall('stepcat', nodes);
}

export function stepalt(...nodes: unknown[]): PatternBuilder {
  return patternCall('stepalt', nodes);
}

export function zip(...nodes: unknown[]): PatternBuilder {
  return patternCall('zip', nodes);
}

export function polyrhythm(...nodes: unknown[]): PatternBuilder {
  return patternCall('polyrhythm', nodes);
}

export function polymeter(...nodes: unknown[]): PatternBuilder {
  return patternCall('polymeter', nodes);
}

export function s(source: unknown): PatternBuilder {
  return patternCall('s', [source]);
}

export function n(source: unknown): PatternBuilder {
  return patternCall('n', [source]);
}

export function chord(source: unknown): PatternBuilder {
  return patternCall('chord', [source]);
}

export function note(source: unknown): PatternBuilder {
  return patternCall('note', [source]);
}

export function sound(source: unknown): PatternBuilder {
  return patternCall('sound', [source]);
}

export function input(name: unknown, fallback?: unknown): SignalBuilder {
  return signalCall('input', fallback === undefined ? [name] : [name, fallback]);
}

export function midi(control: unknown, port?: unknown): SignalBuilder {
  return signalCall('midi', port === undefined ? [control] : [control, port]);
}

export function cc(control: unknown, port?: unknown): SignalBuilder {
  return signalCall('cc', port === undefined ? [control] : [control, port]);
}

export function gamepad(control: unknown, index?: unknown): SignalBuilder {
  return signalCall('gamepad', index === undefined ? [control] : [control, index]);
}

export function motion(axis: unknown): SignalBuilder {
  return signalCall('motion', [axis]);
}

export function csound(instrument: unknown, pattern: unknown): PatternBuilder {
  return toPatternBuilder(pattern).csound(instrument);
}

export function csoundm(instrument: unknown, pattern: unknown): PatternBuilder {
  return toPatternBuilder(pattern).csoundm(instrument);
}

export const fast = fastTransform;
export const slow = slowTransform;
export const ply = plyTransform;
export const add = addTransform;
export const compress = compressTransform;
export const contract = contractTransform;
export const sub = subTransform;
export const mul = mulTransform;
export const div = divTransform;
export const drop = dropTransform;
export const early = earlyTransform;
export const expand = expandTransform;
export const extend = extendTransform;
export const fastGap = fastGapTransform;
export const grow = growTransform;
export const hurry = hurryTransform;
export const late = lateTransform;
export const linger = lingerTransform;
export const pace = paceTransform;
export const rev = revTransform;
export const slowGap = slowGapTransform;
export const scramble = scrambleTransform;
export const shuffle = shuffleTransform;
export const shrink = shrinkTransform;
export const take = takeTransform;
export const zoom = zoomTransform;

export function silence(): PatternBuilder {
  return patternCall('silence');
}

export function value(source: unknown): PatternBuilder {
  return patternCall('value', [source]);
}

export function mini(strings: TemplateStringsArray | string, ...values: unknown[]): string {
  if (typeof strings === 'string') {
    return strings;
  }

  return strings.reduce(
    (acc, chunk, index) => `${acc}${chunk}${index < values.length ? (values[index] ?? '') : ''}`,
    '',
  );
}

export const m = mini;

export function mondo(strings: TemplateStringsArray | string, ...values: unknown[]): PatternBuilder {
  const source =
    typeof strings === 'string'
      ? strings
      : strings.reduce(
          (acc, chunk, index) => `${acc}${chunk}${index < values.length ? (values[index] ?? '') : ''}`,
          '',
        );
  return patternCall('mondo', [source]);
}

export const rand = signalCall('rand');
export const perlin = signalCall('perlin');
export const cosine = signalCall('cosine');
export const saw = signalCall('saw');
export const sine = signalCall('sine');
export const square = signalCall('square');
export const triangle = signalCall('triangle');
export const tri = signalCall('tri');

function registerCustomPatternMethod(name: string): void {
  if (!/^[A-Za-z_$][\w$]*$/.test(name) || name in PatternBuilder.prototype) {
    return;
  }

  Object.defineProperty(PatternBuilder.prototype, name, {
    configurable: true,
    enumerable: false,
    value(this: PatternBuilder, ...args: unknown[]) {
      return (
        this as PatternBuilder & {
          method: (methodName: string, methodArgs: unknown[]) => PatternBuilder;
        }
      ).method(name, args);
    },
    writable: true,
  });
}

export function createParam(name: string): (value: unknown) => PatternBuilder {
  registerCustomPatternMethod(name);
  return (value: unknown) => patternCall(name, [value]);
}

export function createParams<const TNames extends readonly string[]>(
  ...names: TNames
): { [TKey in TNames[number]]: (value: unknown) => PatternBuilder } {
  return Object.fromEntries(names.map((name) => [name, createParam(name)])) as {
    [TKey in TNames[number]]: (value: unknown) => PatternBuilder;
  };
}

const STRING_PATTERN_METHODS = [
  'add',
  'almostAlways',
  'almostNever',
  'compress',
  'contract',
  'degrade',
  'degradeBy',
  'div',
  'drop',
  'edo',
  'every',
  'early',
  'expand',
  'extend',
  'fast',
  'fastGap',
  'grow',
  'hurry',
  'jux',
  'juxBy',
  'late',
  'layer',
  'linger',
  'log',
  'loop',
  'midichan',
  'midicc',
  'midiport',
  'midivalue',
  'mul',
  'off',
  'often',
  'osc',
  'oschost',
  'oscport',
  'pace',
  'ply',
  'rarely',
  'rev',
  'rootNotes',
  'scramble',
  'scale',
  'scaleTranspose',
  'shuffle',
  'shrink',
  'slow',
  'slowGap',
  'sometimes',
  'sometimesBy',
  'sub',
  'superimpose',
  'take',
  'tour',
  'transpose',
  'velocity',
  'voicings',
  'when',
  'within',
  'zoom',
] as const;

const STRING_EXTENSION_STATE_KEY = Symbol.for('tussel.stringPrototypeExtensions');

interface StringExtensionState {
  installedMethods: Set<string>;
  refCount: number;
}

function getStringExtensionState(): StringExtensionState {
  const globalState = globalThis as Record<PropertyKey, unknown>;
  const existing = globalState[STRING_EXTENSION_STATE_KEY];
  if (existing && typeof existing === 'object') {
    return existing as StringExtensionState;
  }

  const state: StringExtensionState = {
    installedMethods: new Set<string>(),
    refCount: 0,
  };
  globalState[STRING_EXTENSION_STATE_KEY] = state;
  return state;
}

export function installStringPrototypeExtensions(): void {
  const state = getStringExtensionState();
  if (state.refCount > 0) {
    state.refCount += 1;
    return;
  }

  for (const method of STRING_PATTERN_METHODS) {
    if (Object.hasOwn(String.prototype, method)) {
      continue;
    }

    Object.defineProperty(String.prototype, method, {
      configurable: true,
      enumerable: false,
      value(this: string, ...args: unknown[]) {
        if (method === 'log') {
          console.log(String(this));
          return String(this);
        }
        const builder = value(String(this));
        const fn = builder[method] as (...methodArgs: unknown[]) => PatternBuilder;
        return fn.apply(builder, args);
      },
      writable: true,
    });
    state.installedMethods.add(method);
  }

  state.refCount = 1;
}

export function uninstallStringPrototypeExtensions(): void {
  const state = getStringExtensionState();
  if (state.refCount === 0) {
    return;
  }

  state.refCount -= 1;
  if (state.refCount > 0) {
    return;
  }

  for (const method of state.installedMethods) {
    Reflect.deleteProperty(String.prototype, method);
  }
  state.installedMethods.clear();
}

export function areStringPrototypeExtensionsInstalled(): boolean {
  return getStringExtensionState().refCount > 0;
}

export function scene<TScene extends SceneInput>(input: TScene): TScene {
  return input;
}

export function defineScene(input: SceneInput | SceneSpec): SceneSpec {
  if (!isPlainObject(input)) {
    throw new TypeError('defineScene() expects a scene object with channels or a root expression.');
  }
  const normalized = normalizeSceneInput(input);
  assertSceneSpec(normalized);
  return normalized;
}

function normalizeSceneInput(input: SceneInput | SceneSpec): SceneSpec {
  const sceneInput = normalizeValue(input) as IRSceneInput & Record<string, unknown>;
  const transport = { ...(sceneInput.transport ?? {}) } as TransportSpec;
  const samples = (sceneInput.samples ?? []).map((entry) =>
    normalizeSampleSource(entry as SampleSourceSpec | string),
  );
  let metadata = sceneInput.metadata as MetadataSpec | undefined;
  let master = sceneInput.master as SceneSpec['master'];
  const channels: Record<string, ChannelSpec> = {};

  if (sceneInput.channels) {
    for (const [name, channel] of Object.entries(sceneInput.channels)) {
      channels[name] = normalizeChannelSpec(normalizeValue(channel));
    }
  }

  if (sceneInput.root) {
    const normalizedRoot = normalizeRootFragment(sceneInput.root);
    Object.assign(channels, normalizedRoot.channels);
    Object.assign(transport, normalizedRoot.transport);
    metadata = { ...(metadata ?? {}), ...(normalizedRoot.metadata ?? {}) };
    master = { ...(master ?? {}), ...(normalizedRoot.master ?? {}) };
    samples.push(...normalizedRoot.samples);
  }

  if (Object.keys(channels).length === 0) {
    throw new Error(
      'defineScene() requires at least one channel or a root expression. Received an empty scene.',
    );
  }

  return { channels, master, metadata, samples, transport };
}

function normalizeRootFragment(root: ExpressionValue): {
  channels: Record<string, ChannelSpec>;
  master?: SceneSpec['master'];
  metadata?: MetadataSpec;
  samples: SampleSourceSpec[];
  transport: TransportSpec;
} {
  const stackEntries = unwrapStackEntries(root);
  if (stackEntries) {
    return {
      channels: Object.fromEntries(
        stackEntries.map((entry, index) => [`layer${index + 1}`, { node: entry }]),
      ),
      samples: [],
      transport: {},
    };
  }

  if (isPlainObject(root) && 'channels' in root) {
    const fragment = root as SceneInput;
    const channels: Record<string, ChannelSpec> = {};
    for (const [name, channel] of Object.entries(fragment.channels ?? {})) {
      channels[name] = normalizeChannelSpec(normalizeValue(channel));
    }
    return {
      channels,
      master: fragment.master,
      metadata: fragment.metadata,
      samples: (fragment.samples ?? []).map((entry) =>
        normalizeSampleSource(entry as SampleSourceSpec | string),
      ),
      transport: fragment.transport ?? {},
    };
  }

  return {
    channels: { main: { node: root } },
    samples: [],
    transport: {},
  };
}

function unwrapStackEntries(root: ExpressionValue): ExpressionValue[] | undefined {
  if (!isExpressionNode(root)) {
    return undefined;
  }

  if (root.kind === 'call' && root.name === 'stack') {
    return root.args;
  }

  if (root.kind === 'method') {
    const entries = unwrapStackEntries(root.target);
    if (!entries) {
      return undefined;
    }

    return entries.map((entry) => createMethodExpression(entry, root.name, root.args, root.exprType));
  }

  return undefined;
}

export class SceneRecorder {
  private metadata: MetadataSpec = {};
  private hydra: HydraSceneSpec | undefined;
  private readonly resettable = {
    root: undefined as ExpressionValue | undefined,
    samples: [] as SampleSourceSpec[],
    transport: {} as TransportSpec,
  };

  beginModule(metadata: MetadataSpec = {}): void {
    this.resettable.root = undefined;
    this.resettable.samples = [];
    this.resettable.transport = {};
    this.metadata = metadata;
    this.hydra = normalizeHydraSceneSpec(metadata.hydra);
  }

  finalize(): SceneSpec {
    const metadata = { ...this.metadata };
    if (this.hydra) {
      metadata.hydra = serializeHydraSceneSpec(this.hydra);
    } else {
      delete metadata.hydra;
    }

    return defineScene({
      metadata,
      root: this.resettable.root,
      samples: this.resettable.samples,
      transport: this.resettable.transport,
    });
  }

  registerSample(ref: string): void {
    this.resettable.samples.push({ ref });
  }

  setBpm(value: unknown): void {
    this.resettable.transport.bpm = normalizeValue(value);
  }

  setCps(value: unknown): void {
    this.resettable.transport.cps = normalizeValue(value);
  }

  setMetadata(metadata: MetadataSpec): void {
    this.metadata = { ...this.metadata, ...metadata };
    this.hydra = normalizeHydraSceneSpec(this.metadata.hydra) ?? this.hydra;
  }

  setRoot(value: unknown): unknown {
    this.resettable.root = normalizeValue(value);
    return value;
  }

  initHydra(options: Record<string, unknown> = {}): HydraSceneSpec {
    const current = this.hydra ?? { options: {}, programs: [] };
    this.hydra = {
      options: { ...current.options, ...options },
      programs: current.programs,
    };
    this.metadata = { ...this.metadata, hydra: serializeHydraSceneSpec(this.hydra) };
    return this.hydra;
  }

  appendHydraProgram(code: string): string {
    const normalized = code.trim();
    if (!normalized) {
      return code;
    }
    const current = this.hydra ?? { options: {}, programs: [] };
    this.hydra = {
      options: current.options,
      programs: [...current.programs, { code: normalized }],
    };
    this.metadata = { ...this.metadata, hydra: serializeHydraSceneSpec(this.hydra) };
    return normalized;
  }

  clearHydra(): void {
    this.hydra = undefined;
    const metadata = { ...this.metadata };
    delete metadata.hydra;
    this.metadata = metadata;
  }
}

export const __tusselRecorder = new SceneRecorder();

function serializeHydraSceneSpec(hydra: HydraSceneSpec): ExpressionValue {
  return {
    options: normalizeValue(hydra.options),
    programs: hydra.programs.map((program) => ({ code: program.code })),
  };
}

export function initHydra(options: Record<string, unknown> = {}): HydraSceneSpec {
  return __tusselRecorder.initHydra(options);
}

export function hydra(strings: TemplateStringsArray | string, ...values: unknown[]): string {
  const code = renderHydraTemplate(strings, values);
  return __tusselRecorder.appendHydraProgram(code);
}

export function clearHydra(): void {
  __tusselRecorder.clearHydra();
}

export function H(value: unknown): string {
  if (value === undefined) {
    throw new TusselHydraError('H() requires a value or pattern reference.');
  }
  if (typeof value === 'string') {
    return `H(${JSON.stringify(value)})`;
  }
  if (typeof value === 'number') {
    return `H(${value})`;
  }
  return `H(${renderValue(normalizeValue(value))})`;
}

export function samples(ref: string): void {
  __tusselRecorder.registerSample(ref);
}

export function setbpm(value: unknown): void {
  __tusselRecorder.setBpm(value);
}

export function setcps(value: unknown): void {
  __tusselRecorder.setCps(value);
}

export function setcpm(value: unknown): void {
  if (typeof value === 'number') {
    __tusselRecorder.setCps(value / 60);
    return;
  }
  __tusselRecorder.setCps(value);
}
