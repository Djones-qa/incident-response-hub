import type { ErrorResponse } from '@incident-hub/shared-types';

export function createValidationError(
  message: string,
  details?: Record<string, unknown>,
): ErrorResponse {
  return {
    error: {
      code: 'VALIDATION_ERROR',
      message,
      details,
    },
    statusCode: 400,
  };
}

export function createNotFoundError(resource: string, id: string): ErrorResponse {
  return {
    error: {
      code: 'NOT_FOUND',
      message: `${resource} with id '${id}' was not found`,
    },
    statusCode: 404,
  };
}

export function createConflictError(message: string): ErrorResponse {
  return {
    error: {
      code: 'CONFLICT',
      message,
    },
    statusCode: 409,
  };
}

export function createServiceUnavailableError(message: string): ErrorResponse {
  return {
    error: {
      code: 'SERVICE_UNAVAILABLE',
      message,
    },
    statusCode: 503,
  };
}
