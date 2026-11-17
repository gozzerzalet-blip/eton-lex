import type { NextFunction, Request, Response } from 'express';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Sesión no válida.') => new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'No tienes permiso para esta acción.') => new ApiError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Recurso no encontrado.') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new ApiError(409, 'CONFLICT', message);

export const asyncHandler =
  <T extends Request = Request>(fn: (req: T, res: Response, next: NextFunction) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  const anyErr = err as { name?: string; message?: string; code?: string };
  if (anyErr?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'Ese registro ya existe.' } });
    return;
  }
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Ocurrió un error interno. Inténtalo nuevamente.',
    },
  });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } });
}
