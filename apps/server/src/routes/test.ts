// Test controls, registered only when KATORI_AI=fake. They let the browser checklist drive the
// failure paths: an error, a timeout and a signed-out status.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FakeRunner } from '../ai/fake-runner.js';
import type { Ctx } from '../context.js';
import { HttpError, parse } from '../lib/http.js';
import { getProfileRow } from '../services/profiles.js';

const FakeControl = z.object({
  mode: z.enum(['ok', 'error', 'timeout', 'invalid']).optional(),
  auth: z.object({ profileId: z.string(), ok: z.boolean() }).optional(),
});

export const testRoutes =
  (ctx: Ctx): FastifyPluginAsync =>
  async (app) => {
    const fake = () => {
      if (!(ctx.runner instanceof FakeRunner)) throw new HttpError(400, 'Not running the fake AI runner');
      return ctx.runner;
    };

    app.get('/api/_test/fake', async () => ({ mode: fake().getMode() }));

    app.post('/api/_test/fake', async (req) => {
      const input = parse(FakeControl, req.body);
      const f = fake();
      if (input.mode) f.setMode(input.mode);
      if (input.auth) {
        f.setAuth(input.auth.profileId, input.auth.ok);
        await ctx.auth.check(getProfileRow(ctx.db, input.auth.profileId));
      }
      return { mode: f.getMode() };
    });

    app.post('/api/_test/reset', async () => {
      fake().reset();
      await ctx.auth.checkAll();
      return { mode: fake().getMode() };
    });
  };
