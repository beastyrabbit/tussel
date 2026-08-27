/**
 * Single source of truth for pattern-method metadata across Tussel layers.
 *
 * Before this registry existed, the same ~100 method names were hand-maintained
 * in six places (core PROPERTY_METHODS, dsl STRING_PATTERN_METHODS, runtime
 * BUILTIN_PATTERN_METHODS, parity BUILTIN_METHODS / ZERO_ARG_IDENTIFIERS, plus
 * stale copies inside tests). Each layer now derives its view from this table,
 * so adding a method means editing one row here instead of six lists.
 *
 * Execution semantics still live in core's `queryPattern` switch — this table
 * carries *metadata*, not behaviour.
 */

/** Coarse classification used for docs, tooling, and property-set derivation. */
export type PatternMethodKind = 'property' | 'time' | 'structure' | 'numeric' | 'compose' | 'condition';

export interface PatternMethodDescriptor {
  /** Canonical method name as written in the DSL. */
  readonly name: string;
  readonly kind: PatternMethodKind;
  /**
   * Safe to install as a String.prototype extension (`"bd".fast(2)`).
   * Excludes names colliding with native String methods (`anchor`) and
   * high-frequency property methods kept off the prototype deliberately.
   */
  readonly stringSafe: boolean;
  /**
   * Has a direct Strudel mapping for parity emission. False for MIDI/OSC/
   * CSound-only names with no Strudel equivalent.
   */
  readonly strudelSupported: boolean;
}

const property = (name: string, strudelSupported: boolean, stringSafe = false): PatternMethodDescriptor => ({
  name,
  kind: 'property',
  stringSafe,
  strudelSupported,
});

const method = (
  name: string,
  kind: Exclude<PatternMethodKind, 'property'>,
  strudelSupported: boolean,
  stringSafe = true,
): PatternMethodDescriptor => ({ name, kind, stringSafe, strudelSupported });

const alias = (name: string, kind: Exclude<PatternMethodKind, 'property'>): PatternMethodDescriptor => ({
  name,
  kind,
  stringSafe: true,
  strudelSupported: false,
});

/**
 * The registry. Sorted by name; keep entries one-per-line for reviewable diffs.
 */
export const PATTERN_METHOD_REGISTRY: readonly PatternMethodDescriptor[] = [
  // -- Property annotations -------------------------------------------------
  property('_punchcard', true),
  property('_scope', true),
  property('accelerate', true),
  property('anchor', true),
  property('attack', true),
  property('bandf', true),
  property('bandq', true),
  property('bank', true),
  property('begin', true),
  property('ccn', false),
  property('ccv', false),
  property('clip', true),
  property('coarse', true),
  property('color', true),
  property('cutoff', true),
  property('csound', false),
  property('csoundm', false),
  property('crush', true),
  property('cut', true),
  property('decay', true),
  property('delay', true),
  property('dict', true),
  property('edo', false, true),
  property('end', true),
  property('fm', true),
  property('freq', true),
  property('gain', true),
  property('hcutoff', true),
  property('hpf', true),
  property('hresonance', true),
  property('loop', true, true),
  property('lpf', true),
  property('lpq', true),
  property('midibend', false),
  property('midicc', false, true),
  property('midichan', false, true),
  property('midicmd', false),
  property('midiport', false, true),
  property('miditouch', false),
  property('midivalue', false, true),
  property('mode', true),
  property('n', true),
  property('note', true),
  property('offset', true),
  property('orbit', true),
  property('osc', false, true),
  property('oschost', false, true),
  property('oscport', false, true),
  property('pan', true),
  property('phaser', true),
  property('punchcard', true),
  property('release', true),
  property('room', true),
  property('s', true),
  property('segment', true),
  property('set', true),
  property('shape', true),
  property('size', true),
  property('sound', true),
  property('speed', true),
  property('struct', true),
  property('sustain', true),
  property('tune', true),
  property('unit', true),
  property('up', true),
  property('velocity', false, true),
  property('vowel', false),

  // -- Time modifiers -------------------------------------------------------
  method('compress', 'time', true),
  method('cpm', 'time', false),
  method('density', 'time', false),
  method('early', 'time', true),
  method('fast', 'time', true),
  method('fastGap', 'time', true),
  method('grow', 'time', false),
  method('hurry', 'time', true),
  method('iter', 'time', false),
  method('iterBack', 'time', false),
  method('late', 'time', true),
  method('linger', 'time', true),
  method('pace', 'time', true),
  method('ribbon', 'time', false),
  method('slow', 'time', true),
  method('slowGap', 'time', true),
  method('slowspread', 'structure', true),
  method('sparsity', 'time', false),
  method('swing', 'time', false),
  method('swingBy', 'time', false),

  // -- Structural transforms ------------------------------------------------
  method('bite', 'structure', true),
  method('chop', 'structure', true),
  method('chunk', 'structure', true, false),
  method('contract', 'structure', true),
  method('drop', 'structure', true),
  method('euclidLegato', 'structure', false),
  method('euclidRot', 'structure', false),
  method('expand', 'structure', true),
  method('extend', 'structure', true),
  method('fastspread', 'structure', true),
  method('fit', 'structure', true),
  method('inside', 'structure', false),
  method('legato', 'structure', true),
  method('mask', 'structure', true, false),
  method('outside', 'structure', false),
  method('palindrome', 'structure', false),
  method('ply', 'structure', true),
  method('rev', 'structure', true),
  method('rootNotes', 'structure', true),
  method('scale', 'structure', true),
  method('scaleTranspose', 'structure', true),
  method('scramble', 'structure', true),
  method('shuffle', 'structure', true),
  method('shrink', 'structure', true),
  method('spin', 'structure', true),
  method('striate', 'structure', true),
  method('stut', 'structure', true),
  method('take', 'structure', true),
  method('tour', 'structure', true),
  method('transpose', 'structure', true),
  method('voicing', 'structure', true, false),
  method('voicings', 'structure', true),
  method('zoom', 'structure', true),

  // -- Numeric operators ------------------------------------------------------
  method('add', 'numeric', true),
  method('addIn', 'numeric', false, false),
  method('addMix', 'numeric', false, false),
  method('addOut', 'numeric', false, false),
  method('addReset', 'numeric', false, false),
  method('addRestart', 'numeric', false, false),
  method('addSqueeze', 'numeric', false, false),
  method('addSqueezeout', 'numeric', false, false),
  method('ceil', 'numeric', true, false),
  method('div', 'numeric', true),
  method('floor', 'numeric', true, false),
  method('mul', 'numeric', true),
  method('range', 'numeric', true, false),
  method('round', 'numeric', true, false),
  method('sub', 'numeric', true),

  // -- Composition / layering -----------------------------------------------
  method('jux', 'compose', false),
  method('juxBy', 'compose', false),
  method('layer', 'compose', false),
  method('off', 'compose', false),
  method('superimpose', 'compose', false),

  // fmap wraps the target in a function applied at query time.
  method('fmap', 'compose', false),

  // -- Conditional modifiers --------------------------------------------------
  method('almostAlways', 'condition', false),
  method('almostNever', 'condition', false),
  method('degrade', 'condition', false),
  method('degradeBy', 'condition', false),
  method('every', 'condition', false),
  method('often', 'condition', false),
  method('rarely', 'condition', true),
  method('sometimes', 'condition', false),
  method('sometimesBy', 'condition', false),
  method('when', 'condition', false),
  method('whenmod', 'condition', true),
  method('within', 'condition', false),

  // -- Special cases ----------------------------------------------------------
  // log is special-cased at install time (intentional console.log).
  { name: 'log', kind: 'compose', stringSafe: true, strudelSupported: true },
  // Aliases of canonical methods (euclidRot / iterBack / ribbon).
  alias('euclidrot', 'structure'),
  alias('iterback', 'time'),
  alias('rib', 'time'),
];

/** All canonical names plus aliases, as a set. */
export const ALL_PATTERN_METHOD_NAMES: ReadonlySet<string> = new Set(
  PATTERN_METHOD_REGISTRY.map((entry) => entry.name),
);

/**
 * Methods executed as simple event-payload annotations by core's
 * `queryPattern` default branch (the former hand-maintained `PROPERTY_METHODS`).
 */
export const PROPERTY_METHOD_NAMES: ReadonlySet<string> = new Set(
  PATTERN_METHOD_REGISTRY.filter((entry) => entry.kind === 'property').map((entry) => entry.name),
);

/**
 * Methods safe to install onto String.prototype (the former hand-maintained
 * `STRING_PATTERN_METHODS` in @tussel/dsl).
 */
export const STRING_SAFE_METHODS: readonly string[] = PATTERN_METHOD_REGISTRY.filter(
  (entry) => entry.stringSafe,
).map((entry) => entry.name);

/**
 * Methods with a direct Strudel mapping for parity emission (the former
 * hand-maintained `BUILTIN_METHODS` in @tussel/parity).
 */
export const STRUDEL_MAPPED_METHODS: ReadonlySet<string> = new Set(
  PATTERN_METHOD_REGISTRY.filter((entry) => entry.strudelSupported).map((entry) => entry.name),
);

/** Zero-argument signal call identifiers (`sine()`, `rand()`, ...). */
export const PATTERN_SIGNAL_IDENTIFIERS: ReadonlySet<string> = new Set([
  'cosine',
  'perlin',
  'rand',
  'saw',
  'sine',
  'square',
  'tri',
  'triangle',
]);
