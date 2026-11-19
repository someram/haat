/**
 * A small, consistent error format.
 * Every error response looks like: { error: { code, message, details? } }
 * Messages never include SQL, stack traces or another tenant's data.
 */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const errors = {
  invalid: (message, details) => new AppError(400, 'INVALID_INPUT', message, details),
  unauthenticated: (message = 'Please log in to continue.') => new AppError(401, 'UNAUTHENTICATED', message),
  forbidden: (message = 'You are not allowed to do that.') => new AppError(403, 'FORBIDDEN', message),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`),
  conflict: (code, message, details) => new AppError(409, code, message, details),
  tenantInactive: () => new AppError(403, 'TENANT_INACTIVE', 'This account has been deactivated by the platform administrator.'),
  storeInactive: () => new AppError(403, 'STORE_INACTIVE', 'This store is not open for shopping right now.'),
};

function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Request body is not valid JSON.' } });
  }
  // Unknown error: log it on the server, return a generic message to the client.
  console.error(err);
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong on the server.' } });
}

module.exports = { AppError, errors, errorHandler };
