export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthorized: (msg = 'Unauthorized') => new AppError('UNAUTHORIZED', msg, 401),
  forbidden: (msg = 'Forbidden') => new AppError('FORBIDDEN', msg, 403),
  notFound: (resource = 'Resource') => new AppError('NOT_FOUND', `${resource} not found`, 404),
  badRequest: (msg: string, meta?: Record<string, unknown>) => new AppError('BAD_REQUEST', msg, 400, meta),
  conflict: (msg: string) => new AppError('CONFLICT', msg, 409),
  rateLimited: (msg = 'Too many requests') => new AppError('RATE_LIMITED', msg, 429),
  paymentRequired: (msg = 'Insufficient credits') => new AppError('PAYMENT_REQUIRED', msg, 402),
  internal: (msg = 'Internal error') => new AppError('INTERNAL', msg, 500),
} as const;
