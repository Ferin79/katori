import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { DateStr, monthOf } from '@katori/shared';
import { todayOf } from '../app.js';
import type { Ctx } from '../context.js';
import { parse } from '../lib/http.js';
import { bodyCsv, mealsCsv } from '../services/export.js';
import { getProfileRow } from '../services/profiles.js';
import { dashboard, journey, monthStats } from '../services/progress.js';
import { getRecap, requestRecap } from '../services/recaps.js';

type P = { Params: { pid: string } };
const Month = z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM');

export const progressRoutes =
  (ctx: Ctx): FastifyPluginAsync =>
  async (app) => {
    const { db } = ctx;

    app.get<P & { Querystring: { date?: string } }>('/api/profiles/:pid/dashboard', async (req) => {
      const date = req.query.date ? parse(DateStr, req.query.date) : todayOf(req);
      return dashboard(db, getProfileRow(db, req.params.pid), date);
    });

    app.get<P & { Querystring: { month?: string } }>('/api/profiles/:pid/month', async (req) => {
      const today = todayOf(req);
      const month = req.query.month ? parse(Month, req.query.month) : monthOf(today);
      const profile = getProfileRow(db, req.params.pid);
      return { ...monthStats(db, profile, month, today), recap: getRecap(db, profile.id, month) };
    });

    app.get<P>('/api/profiles/:pid/journey', async (req) => journey(db, getProfileRow(db, req.params.pid), todayOf(req)));

    app.post<P>('/api/profiles/:pid/recaps', async (req, reply) => {
      const { month } = parse(z.object({ month: Month }), req.body);
      reply.status(202);
      return requestRecap(ctx, getProfileRow(db, req.params.pid), month);
    });

    app.get<P & { Querystring: { from?: string; to?: string } }>('/api/profiles/:pid/export/meals.csv', async (req, reply) => {
      const profile = getProfileRow(db, req.params.pid);
      const csv = mealsCsv(db, profile, req.query.from ? parse(DateStr, req.query.from) : undefined, req.query.to ? parse(DateStr, req.query.to) : undefined);
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="katori-${profile.id}-meals-${todayOf(req)}.csv"`)
        .send(csv);
    });

    app.get<P>('/api/profiles/:pid/export/body.csv', async (req, reply) => {
      const profile = getProfileRow(db, req.params.pid);
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="katori-${profile.id}-body-${todayOf(req)}.csv"`)
        .send(bodyCsv(db, profile, todayOf(req)));
    });
  };
