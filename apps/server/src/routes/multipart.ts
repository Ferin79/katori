import type { FastifyRequest } from 'fastify';
import { badRequest } from '../lib/http.js';

/** Read a multipart form with a JSON `data` field and an optional `photo` file. */
export async function readMealForm(req: FastifyRequest): Promise<{ data: unknown; photo: Buffer | null }> {
  if (!req.isMultipart()) return { data: req.body, photo: null };
  let data: unknown = {};
  let photo: Buffer | null = null;
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'photo') throw badRequest(`Unexpected file field ${part.fieldname}`);
      const buf = await part.toBuffer();
      if (buf.length) photo = buf;
    } else if (part.fieldname === 'data') {
      try {
        data = JSON.parse(String(part.value));
      } catch {
        throw badRequest('data must be JSON');
      }
    }
  }
  return { data, photo };
}
