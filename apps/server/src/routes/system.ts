import { desc } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CalibrationInput, HouseholdSettings, type AiRunRow, type SettingsView, type SystemStatus } from '@katori/shared';
import type { Ctx } from '../context.js';
import { aiRuns } from '../db/schema.js';
import { notFound, parse } from '../lib/http.js';
import { readBackupStatus } from '../services/backup.js';
import { calibrationView, createCalibrationMeal, rerunCalibration, updateCalibrationTruth } from '../services/calibration.js';
import { referenceCount, referenceSources } from '../services/reference.js';
import { getSettings, saveSettings } from '../services/settings.js';
import { readMealForm } from './multipart.js';

export const VERSION = '0.1.0';

export function systemStatus(ctx: Ctx): SystemStatus {
  return {
    aiMode: ctx.runner.mode,
    version: VERSION,
    queue: ctx.queue.status(),
    backup: readBackupStatus(ctx.cfg),
    reference: { count: referenceCount(ctx.db), sources: referenceSources(ctx.db) },
    testMode: ctx.cfg.testMode,
  };
}

export const systemRoutes =
  (ctx: Ctx): FastifyPluginAsync =>
  async (app) => {
    const { db } = ctx;

    app.get('/api/health', async () => ({ ok: true }));

    app.get('/api/system', async () => systemStatus(ctx));

    app.get('/api/settings', async (): Promise<SettingsView> => ({ settings: getSettings(db), system: systemStatus(ctx) }));

    app.put('/api/settings', async (req): Promise<SettingsView> => {
      saveSettings(db, parse(HouseholdSettings, req.body));
      return { settings: getSettings(db), system: systemStatus(ctx) };
    });

    app.get<{ Querystring: { limit?: string } }>('/api/ai-runs', async (req): Promise<AiRunRow[]> => {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 30));
      return db
        .select()
        .from(aiRuns)
        .orderBy(desc(aiRuns.id))
        .limit(limit)
        .all()
        .map((r) => ({
          id: r.id,
          profileId: r.profileId,
          mealId: r.mealId,
          kind: r.kind,
          startedAt: r.startedAt,
          durationMs: r.durationMs,
          model: r.model,
          exitCode: r.exitCode,
          error: r.error,
          calibrationErrorPct: r.calibrationErrorPct,
        }));
    });

    // ----- Calibration -----

    app.get('/api/calibration', async () => calibrationView(ctx));

    app.post<{ Params: { pid: string } }>('/api/profiles/:pid/calibration', async (req, reply) => {
      const { data, photo } = await readMealForm(req);
      reply.status(201);
      return createCalibrationMeal(ctx, req.params.pid, parse(CalibrationInput, data), photo);
    });

    app.post('/api/calibration/rerun', async () => ({ queued: rerunCalibration(ctx) }));

    app.patch<{ Params: { mealId: string } }>('/api/calibration/:mealId', async (req) => {
      const mealId = Number(req.params.mealId);
      if (!Number.isInteger(mealId)) throw notFound('Calibration meal not found');
      const body = parse(z.object({ trueKcal: z.number().min(1).max(5000), trueProteinG: z.number().min(0).max(500).nullable() }), req.body);
      updateCalibrationTruth(ctx, mealId, body.trueKcal, body.trueProteinG);
      return calibrationView(ctx);
    });
  };
