export class ApplicationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 500,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}

export class ValidationError extends ApplicationError {
  public constructor(
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super('validation_error', message, 400, details);
    this.name = 'ValidationError';
  }
}
