import { createReadStream, existsSync } from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AddMealFields, AnswersInput, ConfirmMealInput, DateStr, LocalDateTime, QuickAddInput } from '@katori/shared';
import { todayOf } from '../app.js';
import type { Ctx } from '../context.js';
import { notFound, parse } from '../lib/http.js';
import {
  answerMeal,
  confirmMeal,
  createMeals,
  deleteMeal,
  getMeal,
  listMeals,
  mealPhotoPath,
  quickAdd,
  retryMeal,
  updateMealMeta,
} from '../services/meals.js';
import { readMealForm } from './multipart.js';

type P = { Params: { pid: string } };
type PM = { Params: { pid: string; id: string } };

const id = (s: string) => {
  const n = Number(s);
  if (!Number.isInteger(n)) throw notFound('Meal not found');
  return n;
};

export const mealRoutes =
  (ctx: Ctx): FastifyPluginAsync =>
  async (app) => {
    app.get<P & { Querystring: { date?: string } }>('/api/profiles/:pid/meals', async (req) => {
      const date = req.query.date ? parse(DateStr, req.query.date) : todayOf(req);
      return listMeals(ctx.db, req.params.pid, date);
    });

    /** Add meal: multipart with a `data` JSON field (note, slot, eatenAt, portion, alsoFor) and an optional `photo`. */
    app.post<P>('/api/profiles/:pid/meals', async (req, reply) => {
      const { data, photo } = await readMealForm(req);
      const fields = parse(AddMealFields, data);
      reply.status(201);
      return createMeals(ctx, req.params.pid, fields, photo);
    });

    app.post<P>('/api/profiles/:pid/meals/quick', async (req, reply) => {
      reply.status(201);
      return quickAdd(ctx, req.params.pid, parse(QuickAddInput, req.body));
    });

    app.get<PM>('/api/profiles/:pid/meals/:id', async (req) => getMeal(ctx.db, req.params.pid, id(req.params.id)));

    app.patch<PM>('/api/profiles/:pid/meals/:id', async (req) => {
      const patch = parse(z.object({ slot: z.string().min(1).max(24).optional(), eatenAt: LocalDateTime.optional(), note: z.string().max(500).optional() }), req.body);
      return updateMealMeta(ctx, req.params.pid, id(req.params.id), patch);
    });

    app.delete<PM>('/api/profiles/:pid/meals/:id', async (req, reply) => {
      deleteMeal(ctx, req.params.pid, id(req.params.id));
      return reply.status(204).send();
    });

    app.post<PM>('/api/profiles/:pid/meals/:id/confirm', async (req) => confirmMeal(ctx, req.params.pid, id(req.params.id), parse(ConfirmMealInput, req.body)));

    app.post<PM>('/api/profiles/:pid/meals/:id/answers', async (req) => answerMeal(ctx, req.params.pid, id(req.params.id), parse(AnswersInput, req.body)));

    app.post<PM>('/api/profiles/:pid/meals/:id/retry', async (req) => retryMeal(ctx, req.params.pid, id(req.params.id)));

    app.get<PM>('/api/profiles/:pid/meals/:id/photo', async (req, reply) => {
      const file = mealPhotoPath(ctx, req.params.pid, id(req.params.id));
      if (!file || !existsSync(file)) throw notFound('No photo');
      const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      return reply.type(type).header('cache-control', 'private, max-age=86400').send(createReadStream(file));
    });
  };
