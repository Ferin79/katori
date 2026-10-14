import type { FastifyPluginAsync } from 'fastify';
import { MyFoodInput } from '@katori/shared';
import { todayOf } from '../app.js';
import type { Ctx } from '../context.js';
import { notFound, parse } from '../lib/http.js';
import { createFood, deleteFood, listFoods, quickAddFoods, updateFood } from '../services/foods.js';
import { getProfileRow } from '../services/profiles.js';
import { searchReference } from '../services/reference.js';

type P = { Params: { pid: string } };
type PF = { Params: { pid: string; id: string } };

const fid = (s: string) => {
  const n = Number(s);
  if (!Number.isInteger(n)) throw notFound('Saved food not found');
  return n;
};

export const foodRoutes =
  (ctx: Ctx): FastifyPluginAsync =>
  async (app) => {
    const { db } = ctx;

    app.get<P>('/api/profiles/:pid/foods', async (req) => {
      getProfileRow(db, req.params.pid);
      return listFoods(db, req.params.pid, todayOf(req));
    });

    app.get<P>('/api/profiles/:pid/foods/quick', async (req) => {
      getProfileRow(db, req.params.pid);
      return quickAddFoods(db, req.params.pid, todayOf(req));
    });

    app.post<P>('/api/profiles/:pid/foods', async (req, reply) => {
      getProfileRow(db, req.params.pid);
      reply.status(201);
      return createFood(db, req.params.pid, parse(MyFoodInput, req.body));
    });

    app.put<PF>('/api/profiles/:pid/foods/:id', async (req) => updateFood(db, req.params.pid, fid(req.params.id), parse(MyFoodInput, req.body)));

    app.delete<PF>('/api/profiles/:pid/foods/:id', async (req, reply) => {
      deleteFood(db, req.params.pid, fid(req.params.id));
      return reply.status(204).send();
    });

    app.get<{ Querystring: { q?: string } }>('/api/reference/search', async (req) => searchReference(db, req.query.q ?? '', 12));
  };
