import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what, 'not_found');
export const badRequest = (msg: string) => new HttpError(400, msg, 'bad_request');

/** Validate input with a Zod schema; a failure becomes a 400 naming the first bad field. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw badRequest(`${where}${issue?.message ?? 'Invalid input'}`);
  }
  return r.data;
}

export function nowIso(): string {
  return new Date().toISOString();
}
