import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ManualTargetInput, Pin, PinInput, ProfileInput, ProfileUpdate } from '@katori/shared';
import { todayOf } from '../app.js';
import type { Ctx } from '../context.js';
import { profiles } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { HttpError, parse } from '../lib/http.js';
import { hashPin, makeUnlockToken, verifyPin } from '../services/pin.js';
import { createProfile, deleteProfile, getProfileRow, listProfiles, toProfile, updateProfile } from '../services/profiles.js';
import { serverSecret } from '../services/settings.js';
import { decideSuggestion, recalcFormula, setManualTarget, targetsView } from '../services/targets.js';

type P = { Params: { pid: string } };

export const profileRoutes =
  (ctx: Ctx): FastifyPluginAsync =>
  async (app) => {
    const { db } = ctx;

    app.get('/api/profiles', async (req) => listProfiles(ctx, todayOf(req)));

    app.post('/api/profiles', async (req, reply) => {
      const input = parse(ProfileInput, req.body);
      reply.status(201);
      return createProfile(ctx, input, todayOf(req));
    });

    app.get<P>('/api/profiles/:pid', async (req) => toProfile(ctx, getProfileRow(db, req.params.pid), todayOf(req)));

    app.patch<P>('/api/profiles/:pid', async (req) => updateProfile(ctx, req.params.pid, parse(ProfileUpdate, req.body), todayOf(req)));

    app.delete<P>('/api/profiles/:pid', async (req, reply) => {
      deleteProfile(ctx, req.params.pid);
      return reply.status(204).send();
    });

    // ----- PINs -----

    app.post<P>('/api/profiles/:pid/unlock', async (req) => {
      const { pin } = parse(z.object({ pin: Pin }), req.body);
      const profile = getProfileRow(db, req.params.pid);
      if (!profile.pinHash) return { token: null };
      if (!verifyPin(pin, profile.pinHash)) throw new HttpError(403, 'Wrong PIN', 'wrong_pin');
      return { token: makeUnlockToken(serverSecret(db), profile.id, profile.pinHash) };
    });

    app.put<P>('/api/profiles/:pid/pin', async (req) => {
      const input = parse(PinInput, req.body);
      const profile = getProfileRow(db, req.params.pid);
      // Reaching here already required the unlock token when a PIN is set; ask for it again anyway.
      if (profile.pinHash && (!input.currentPin || !verifyPin(input.currentPin, profile.pinHash))) {
        throw new HttpError(403, 'Enter the current PIN to change it', 'wrong_pin');
      }
      const pinHash = input.pin ? hashPin(input.pin) : null;
      db.update(profiles).set({ pinHash }).where(eq(profiles.id, profile.id)).run();
      return { hasPin: Boolean(pinHash), token: pinHash ? makeUnlockToken(serverSecret(db), profile.id, pinHash) : null };
    });

    // ----- AI access -----

    app.get<P>('/api/profiles/:pid/ai-status', async (req) => ctx.auth.get(getProfileRow(db, req.params.pid)));
    app.post<P>('/api/profiles/:pid/ai-status/check', async (req) => ctx.auth.check(getProfileRow(db, req.params.pid)));

    // ----- Targets -----

    app.get<P>('/api/profiles/:pid/targets', async (req) => targetsView(db, getProfileRow(db, req.params.pid), todayOf(req)));

    app.put<P>('/api/profiles/:pid/targets', async (req) => {
      const profile = getProfileRow(db, req.params.pid);
      setManualTarget(db, profile, parse(ManualTargetInput, req.body), todayOf(req));
      return targetsView(db, profile, todayOf(req));
    });

    app.post<P>('/api/profiles/:pid/targets/recalculate', async (req) => {
      const profile = getProfileRow(db, req.params.pid);
      recalcFormula(db, profile, todayOf(req));
      return targetsView(db, profile, todayOf(req));
    });

    app.post<P>('/api/profiles/:pid/targets/suggestion', async (req) => {
      const { action } = parse(z.object({ action: z.enum(['accepted', 'dismissed']) }), req.body);
      const profile = getProfileRow(db, req.params.pid);
      decideSuggestion(db, profile, todayOf(req), action);
      return targetsView(db, profile, todayOf(req));
    });
  };
