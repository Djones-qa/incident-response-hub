import { Request, Response, NextFunction } from 'express';
import { createServiceUnavailableError } from '@incident-hub/shared-utils';

/**
 * PostgreSQL error codes that indicate the database is unavailable.
 * See: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const DB_CONNECTION_ERROR_CODES = new Set([
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
]);

/**
 * Determines whether an error represents a database connection failure.
 */
export function isDatabaseConnectionError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;

    // pg library sets a `code` property for PostgreSQL error codes
    if (typeof err.code === 'string' && DB_CONNECTION_ERROR_CODES.has(err.code)) {
      return true;
    }

    // Connection refused / timeout errors from Node.js net layer
    if (
      err.code === 'ECONNREFUSED' ||
      err.code === 'ECONNRESET' ||
      err.code === 'ETIMEDOUT' ||
      err.code === 'EHOSTUNREACH'
    ) {
      return true;
    }

    // Pool timeout (pg pool cannot acquire a client)
    if (typeof err.message === 'string' && err.message.includes('timeout expired')) {
      return true;
    }
  }

  return false;
}

/**
 * Global error-handling middleware for the incident-engine service.
 *
 * Catches any unhandled errors that slip past route-level try/catch blocks.
 * Returns a 503 Service Unavailable response for database connection errors,
 * ensuring no partial records are exposed on writes and reads fail cleanly.
 *
 * Must be registered AFTER all route handlers in the Express app.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error('Unhandled error in incident-engine:', err.message || err);

  if (isDatabaseConnectionError(err)) {
    const errorResponse = createServiceUnavailableError(
      'Database is currently unavailable. Please retry later.',
    );
    res.status(errorResponse.statusCode).json(errorResponse);
    return;
  }

  // For any other unhandled error, return 503 to avoid leaking internals
  const errorResponse = createServiceUnavailableError(
    'An unexpected error occurred. Please retry later.',
  );
  res.status(errorResponse.statusCode).json(errorResponse);
}
