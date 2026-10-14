// In-process queue → claude -p. One job at a time; pending jobs are rows in the DB (meals with
// status 'pending', recaps with status 'pending'), so they survive restarts. Failures retry with
// backoff, then show as Failed with a Retry button.
import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import { sumNutrients } from '@katori/shared';
import type { Ctx } from '../context.js';
import { aiRuns, meals, recaps } from '../db/schema.js';
import { nowIso } from '../lib/http.js';
import { foodsForProfile } from '../services/foods.js';
import { estimateToItems, replaceItems } from '../services/meals.js';
import { photoAbsPath } from '../services/photos.js';
import { getProfileRow } from '../services/profiles.js';
import { processRecap } from '../services/recaps.js';
import { referenceCount } from '../services/reference.js';
import { getSettings } from '../services/settings.js';
import { RunnerError } from './runner.js';

type Job = { kind: 'meal'; id: number } | { kind: 'recap'; profileId: string; month: string };

export class JobQueue {
  private ctx: Ctx | null = null;
  private running = false;
  private dirty = false;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private current: Job | null = null;

  attach(ctx: Ctx) {
    this.ctx = ctx;
  }

  start() {
    this.stopped = false;
    this.kick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Something changed: look for work. Safe to call any time. */
  kick() {
    this.dirty = true;
    if (this.running || this.stopped || !this.ctx) return;
    this.running = true;
    void this.loop().finally(() => {
      this.running = false;
    });
  }

  status() {
    const { db } = this.ctx!;
    const pendingMeals = db.$client.prepare(`SELECT COUNT(*) AS n FROM meals WHERE status = 'pending'`).get() as { n: number };
    const pendingRecaps = db.$client.prepare(`SELECT COUNT(*) AS n FROM recaps WHERE status = 'pending'`).get() as { n: number };
    return { pending: pendingMeals.n + pendingRecaps.n, running: this.current !== null };
  }

  /** Resolves when no job is due (for tests and the seed script). */
  async idle(timeoutMs = 30_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (!this.running && !this.nextJob()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('Queue did not go idle');
  }

  private async loop() {
    for (;;) {
      if (this.stopped) return;
      this.dirty = false;
      const job = this.nextJob();
      if (!job) {
        if (this.dirty) continue;
        this.scheduleWake();
        return;
      }
      this.current = job;
      try {
        if (job.kind === 'meal') await this.processMeal(job.id);
        else await processRecap(this.ctx!, job.profileId, job.month);
      } catch (e) {
        this.ctx!.log.error({ err: e, job }, 'job crashed');
      } finally {
        this.current = null;
      }
    }
  }

  private nextJob(): Job | null {
    const { db } = this.ctx!;
    const now = nowIso();
    const meal = db
      .select({ id: meals.id })
      .from(meals)
      .where(and(eq(meals.status, 'pending'), or(isNull(meals.nextAttemptAt), lte(meals.nextAttemptAt, now))))
      .orderBy(asc(meals.createdAt), asc(meals.id))
      .limit(1)
      .get();
    if (meal) return { kind: 'meal', id: meal.id };
    const recap = db.select().from(recaps).where(eq(recaps.status, 'pending')).orderBy(asc(recaps.createdAt)).limit(1).get();
    if (recap) return { kind: 'recap', profileId: recap.profileId, month: recap.month };
    return null;
  }

  private scheduleWake() {
    if (this.timer) clearTimeout(this.timer);
    const row = this.ctx!.db.$client
      .prepare(`SELECT MIN(next_attempt_at) AS t FROM meals WHERE status = 'pending' AND next_attempt_at IS NOT NULL`)
      .get() as { t: string | null };
    if (!row.t) return;
    const delay = Math.max(50, new Date(row.t).getTime() - Date.now());
    this.timer = setTimeout(() => this.kick(), delay);
    this.timer.unref();
  }

  private async processMeal(id: number) {
    const ctx = this.ctx!;
    const { db, cfg, runner, auth } = ctx;
    const meal = db.select().from(meals).where(eq(meals.id, id)).get();
    if (!meal || meal.status !== 'pending') return;
    const profile = getProfileRow(db, meal.profileId);
    const settings = getSettings(db);
    const foods = foodsForProfile(db, profile.id);
    const started = Date.now();
    const run = db
      .insert(aiRuns)
      .values({ profileId: profile.id, mealId: id, kind: 'estimate', startedAt: new Date(started).toISOString(), model: settings.model })
      .returning({ id: aiRuns.id })
      .get();

    try {
      const res = await runner.estimate({
        profile,
        photoPath: meal.photoPath ? photoAbsPath(cfg, meal.photoPath) : null,
        note: meal.note,
        answers: meal.answers,
        settings,
        savedFoods: foods,
        referenceLookup: settings.referenceLookup && referenceCount(db) > 0,
      });
      const items = estimateToItems(res.estimate, foods, meal.portion);
      const kcal = sumNutrients(items.map((i) => ({ kcal: i.kcal, protein_g: i.proteinG, carbs_g: i.carbsG, fat_g: i.fatG, fiber_g: i.fiberG }))).kcal;
      const calibrationErrorPct = meal.calibration && meal.trueKcal ? ((kcal - meal.trueKcal) / meal.trueKcal) * 100 : null;
      db.transaction((tx) => {
        tx.update(aiRuns)
          .set({ durationMs: Date.now() - started, exitCode: res.exitCode, model: res.model, outputJson: JSON.stringify(res.estimate), calibrationErrorPct })
          .where(eq(aiRuns.id, run.id))
          .run();
        // The meal may have been deleted or edited while Claude was working.
        const still = tx.select({ status: meals.status }).from(meals).where(eq(meals.id, id)).get();
        if (still?.status !== 'pending') return;
        replaceItems(tx, id, items);
        tx.update(meals)
          .set({ status: 'estimated', questions: res.estimate.questions, error: null, nextAttemptAt: null, attempts: meal.attempts + 1 })
          .where(eq(meals.id, id))
          .run();
      });
      auth.markOk(profile.id);
    } catch (e) {
      const err = e instanceof RunnerError ? e : new RunnerError('error', (e as Error).message ?? String(e), true);
      db.update(aiRuns)
        .set({ durationMs: Date.now() - started, exitCode: err.meta.exitCode ?? null, error: `${err.kind}: ${err.message}`, outputJson: err.meta.raw ?? null })
        .where(eq(aiRuns.id, run.id))
        .run();
      if (err.kind === 'auth') auth.markSignedOut(profile.id, err.message);
      const attempts = meal.attempts + 1;
      const still = db.select({ status: meals.status }).from(meals).where(eq(meals.id, id)).get();
      if (still?.status !== 'pending') return;
      if (err.retryable && attempts < cfg.maxAttempts) {
        const delay = cfg.retryBaseMs * 4 ** (attempts - 1);
        db.update(meals)
          .set({ attempts, nextAttemptAt: new Date(Date.now() + delay).toISOString(), error: `${err.message} Retrying (attempt ${attempts + 1} of ${cfg.maxAttempts}).` })
          .where(eq(meals.id, id))
          .run();
      } else {
        db.update(meals).set({ status: 'failed', attempts, nextAttemptAt: null, error: err.message }).where(eq(meals.id, id)).run();
      }
      ctx.log.warn({ meal: id, kind: err.kind, attempts }, `estimate failed: ${err.message}`);
    }
  }
}
