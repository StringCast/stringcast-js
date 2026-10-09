/** A failure with a user-facing message. exitCode 1 = runtime failure, 2 = usage error. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export class UsageError extends CliError {
  constructor(message: string) {
    super(message, 2);
    this.name = 'UsageError';
  }
}
