/**
 * Structured logging for the Tussel runtime.
 *
 * Replaces raw console.log/warn/error calls with a sink-based system that
 * supports programmatic event collection, per-code suppression, and
 * configurable output destinations.
 */

export type LogLevel = 'debug' | 'error' | 'info' | 'warn';

export interface LogEvent {
  code?: string;
  details?: Record<string, unknown>;
  level: LogLevel;
  message: string;
  source: string;
  timestamp: number;
}

export type LogSink = (event: LogEvent) => void;

// ---------------------------------------------------------------------------
// Global sink registry
// ---------------------------------------------------------------------------

const globalSinks: LogSink[] = [];

/** Default console sink — writes human-readable output to stdout/stderr. */
export const consoleSink: LogSink = (event) => {
  const prefix = `[${event.source}]`;
  const msg = `${prefix} ${event.message}`;
  switch (event.level) {
    case 'debug':
    case 'info':
      console.log(msg);
      break;
    case 'warn':
      console.warn(msg);
      break;
    case 'error':
      console.error(msg);
      break;
  }
};

// Install the console sink by default.
globalSinks.push(consoleSink);

/** Add a global sink. Returns an unsubscribe function. */
export function addGlobalLogSink(sink: LogSink): () => void {
  globalSinks.push(sink);
  return () => {
    const idx = globalSinks.indexOf(sink);
    if (idx >= 0) globalSinks.splice(idx, 1);
  };
}

/** Remove all global sinks (including the default console sink). */
export function removeAllGlobalLogSinks(): void {
  globalSinks.length = 0;
}

/** Reset global sinks to only the default console sink. */
export function resetGlobalLogSinks(): void {
  globalSinks.length = 0;
  globalSinks.push(consoleSink);
}

// ---------------------------------------------------------------------------
// Collecting sink — captures events for programmatic access
// ---------------------------------------------------------------------------

export class CollectingSink {
  readonly events: LogEvent[] = [];

  readonly sink: LogSink = (event) => {
    this.events.push(event);
  };

  clear(): void {
    this.events.length = 0;
  }

  /** Return events filtered by level. */
  byLevel(level: LogLevel): LogEvent[] {
    return this.events.filter((e) => e.level === level);
  }

  /** Return events filtered by code. */
  byCode(code: string): LogEvent[] {
    return this.events.filter((e) => e.code === code);
  }
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export interface LogOptions {
  code?: string;
  details?: Record<string, unknown>;
}

export class Logger {
  private suppressionCounts = new Map<string, number>();

  constructor(
    /** Source identifier, e.g. 'tussel/core', 'tussel/audio'. */
    readonly source: string,
    /** Maximum emissions per suppression key before further events are silenced. */
    private readonly maxPerCode: number = 5,
  ) {}

  debug(message: string, options?: LogOptions): void {
    this.emit('debug', message, options);
  }

  info(message: string, options?: LogOptions): void {
    this.emit('info', message, options);
  }

  warn(message: string, options?: LogOptions): void {
    this.emit('warn', message, options);
  }

  error(message: string, options?: LogOptions): void {
    this.emit('error', message, options);
  }

  /**
   * Emit a warning with per-key suppression. After {@link maxPerCode}
   * emissions with the same key, subsequent events are silently dropped.
   * The final allowed emission includes a suppression notice.
   */
  warnOnce(key: string, message: string, details?: Record<string, unknown>): void {
    const count = this.suppressionCounts.get(key) ?? 0;
    if (count >= this.maxPerCode) return;
    this.suppressionCounts.set(key, count + 1);
    if (count === this.maxPerCode - 1) {
      this.emit('warn', `${message} — suppressing further warnings for this key.`, {
        code: key,
        details,
      });
    } else {
      this.emit('warn', message, { code: key, details });
    }
  }

  /**
   * Emit an error with per-key suppression. Same semantics as
   * {@link warnOnce} but at error level.
   */
  errorOnce(key: string, message: string, details?: Record<string, unknown>): void {
    const count = this.suppressionCounts.get(key) ?? 0;
    if (count >= this.maxPerCode) return;
    this.suppressionCounts.set(key, count + 1);
    if (count === this.maxPerCode - 1) {
      this.emit('error', `${message} — suppressing further errors for this key.`, {
        code: key,
        details,
      });
    } else {
      this.emit('error', message, { code: key, details });
    }
  }

  /** Reset per-key suppression counters. */
  resetSuppression(): void {
    this.suppressionCounts.clear();
  }

  private emit(level: LogLevel, message: string, options?: LogOptions): void {
    const event: LogEvent = {
      code: options?.code,
      details: options?.details,
      level,
      message,
      source: this.source,
      timestamp: Date.now(),
    };
    for (const sink of globalSinks) {
      sink(event);
    }
  }
}

/** Create a Logger for the given source. */
export function createLogger(source: string, maxPerCode?: number): Logger {
  return new Logger(source, maxPerCode);
}
