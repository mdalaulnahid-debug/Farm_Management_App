export class AppError extends Error {
  constructor(public status: number, message: string, public code = 'ERROR', public details?: unknown) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, message, 'BAD_REQUEST', details);
export const unauthorized = (message = 'Please sign in.') => new AppError(401, message, 'UNAUTHORIZED');
export const forbidden = (message = 'You do not have permission to do this.') => new AppError(403, message, 'FORBIDDEN');
export const notFound = (what = 'Record') => new AppError(404, `${what} not found.`, 'NOT_FOUND');
export const conflict = (message: string) => new AppError(409, message, 'CONFLICT');
