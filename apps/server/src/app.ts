import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { toDateStr } from '@katori/shared';
import { ClaudeRunner } from './ai/claude-runner.js';
import { FakeRunner } from './ai/fake-runner.js';
import { JobQueue } from './ai/queue.js';
import type { Runner } from './ai/runner.js';
import type { Config } from './config.js';
import type { Ctx } from './context.js';
import { openDb } from './db/client.js';
import { HttpError } from './lib/http.js';
import { AuthMonitor } from './services/auth-status.js';
import { verifyUnlockToken } from './services/pin.js';
import { getProfileRow } from './services/profiles.js';
import { serverSecret } from './services/settings.js';
import { bodyRoutes } from './routes/body.js';
import { foodRoutes } from './routes/foods.js';
import { mealRoutes } from './routes/meals.js';
import { profileRoutes } from './routes/profiles.js';
import { progressRoutes } from './routes/progress.js';
import { systemRoutes } from './routes/system.js';
import { testRoutes } from './routes/test.js';

/** The phone's own calendar date, so "today" is the person's today. */
export function todayOf(req: FastifyRequest): string {
  const h = req.headers['x-katori-date'];
  return typeof h === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h) ? h : toDateStr(new Date());
}

export interface BuiltApp {
  app: FastifyInstance;
  ctx: Ctx;
}

export async function buildApp(cfg: Config, opts: { runner?: Runner; logger?: boolean } = {}): Promise<BuiltApp> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: cfg.logLevel },
    bodyLimit: 2 * 1024 * 1024,
  });

  const db = openDb(cfg.dbPath, cfg.migrationsDir);
  const runner = opts.runner ?? (cfg.aiMode === 'fake' ? new FakeRunner(cfg.fakeDelayMs) : new ClaudeRunner(cfg));
  const queue = new JobQueue();
  const auth = new AuthMonitor(db, cfg, runner, app.log);
  const ctx: Ctx = { db, cfg, runner, queue, auth, log: app.log };
  queue.attach(ctx);

  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 10 } });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message, code: err.code });
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) req.log.error(err);
    return reply.status(status).send({ error: status === 500 ? 'Something went wrong on the server' : err.message, code: err.code });
  });

  // Optional profile PINs: a locked profile's routes need its unlock token.
  app.addHook('preHandler', async (req) => {
    const params = req.params as { pid?: string } | undefined;
    if (!params?.pid || req.routeOptions.url === '/api/profiles/:pid/unlock') return;
    const profile = getProfileRow(db, params.pid);
    if (!profile.pinHash) return;
    const token = (req.headers['x-katori-unlock'] as string | undefined) ?? (req.query as { unlock?: string })?.unlock;
    if (!verifyUnlockToken(serverSecret(db), profile.id, profile.pinHash, token)) {
      throw new HttpError(423, `${profile.name}'s profile is locked`, 'locked');
    }
  });

  await app.register(profileRoutes(ctx));
  await app.register(mealRoutes(ctx));
  await app.register(foodRoutes(ctx));
  await app.register(bodyRoutes(ctx));
  await app.register(progressRoutes(ctx));
  await app.register(systemRoutes(ctx));
  if (cfg.testMode) await app.register(testRoutes(ctx));

  const indexHtml = path.join(cfg.webDist, 'index.html');
  if (existsSync(indexHtml)) {
    // Wildcard: files are looked up per request, so a rebuild is served without a restart;
    // a missing file falls through to the not-found handler (SPA fallback below).
    await app.register(fastifyStatic, { root: cfg.webDist, wildcard: true });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !existsSync(indexHtml) || req.method !== 'GET') {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.type('text/html').sendFile('index.html'); // client-side routes
  });

  app.addHook('onClose', async () => {
    queue.stop();
    auth.stop();
    db.$client.close();
  });

  return { app, ctx };
}
