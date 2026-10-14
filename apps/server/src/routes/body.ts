import type { FastifyPluginAsync } from 'fastify';
import { BodyBackfillInput, BodyLogInput, DateStr } from '@katori/shared';
import { todayOf } from '../app.js';
import type { Ctx } from '../context.js';
import { parse } from '../lib/http.js';
import { backfillWeights, deleteBody, listBody, upsertBody } from '../services/body.js';
import { getProfileRow } from '../services/profiles.js';

type P = { Params: { pid: string } };
type PD = { Params: { pid: string; date: string } };

export const bodyRoutes =
  (ctx: Ctx): FastifyPluginAsync =>
  async (app) => {
    const { db } = ctx;

    app.get<P & { Querystring: { from?: string; to?: string } }>('/api/profiles/:pid/body', async (req) => {
      const profile = getProfileRow(db, req.params.pid);
      const from = req.query.from ? parse(DateStr, req.query.from) : undefined;
      const to = req.query.to ? parse(DateStr, req.query.to) : undefined;
      return listBody(db, profile, todayOf(req), from, to).reverse();
    });

    app.put<PD>('/api/profiles/:pid/body/:date', async (req) => {
      const profile = getProfileRow(db, req.params.pid);
      return { log: upsertBody(db, profile, parse(DateStr, req.params.date), parse(BodyLogInput, req.body), todayOf(req)) };
    });

    app.post<P>('/api/profiles/:pid/body/backfill', async (req) => {
      const profile = getProfileRow(db, req.params.pid);
      return { saved: backfillWeights(db, profile, parse(BodyBackfillInput, req.body), todayOf(req)) };
    });

    app.delete<PD>('/api/profiles/:pid/body/:date', async (req, reply) => {
      getProfileRow(db, req.params.pid);
      deleteBody(db, req.params.pid, parse(DateStr, req.params.date));
      return reply.status(204).send();
    });
  };
