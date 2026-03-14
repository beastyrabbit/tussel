export interface TusselErrorOptions {
  cause?: unknown;
  code?: string;
  details?: Record<string, unknown>;
}

export class TusselError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: TusselErrorOptions = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code ?? 'TUSSEL_ERROR';
    this.details = options.details;
  }
}

export class TusselValidationError extends TusselError {
  constructor(message: string, options: TusselErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'TUSSEL_VALIDATION_ERROR' });
  }
}

export class TusselInputError extends TusselError {
  constructor(message: string, options: TusselErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'TUSSEL_INPUT_ERROR' });
  }
}

export class TusselHydraError extends TusselError {
  constructor(message: string, options: TusselErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'TUSSEL_HYDRA_ERROR' });
  }
}

export class TusselAudioError extends TusselError {
  constructor(message: string, options: TusselErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'TUSSEL_AUDIO_ERROR' });
  }
}

export class TusselSchedulerError extends TusselError {
  constructor(message: string, options: TusselErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'TUSSEL_SCHEDULER_ERROR' });
  }
}

export class TusselNotImplementedError extends TusselError {
  constructor(feature: string, options: TusselErrorOptions = {}) {
    super(`${feature} is not yet implemented.`, {
      ...options,
      code: options.code ?? 'TUSSEL_NOT_IMPLEMENTED',
    });
  }
}
