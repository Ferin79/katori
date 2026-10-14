# Katori: conventions for Claude Code

Read PLAN.md for the product. This file is how the code is put together.

## Shape

- npm workspaces: `packages/shared` (Zod schemas, API types, pure formulas), `apps/server` (Fastify + better-sqlite3/Drizzle + job queue + `katori` CLI), `apps/web` (React 19 + Vite + TanStack Query + Recharts).
- `@katori/shared` ships TypeScript source; Vite, tsx and tsup compile it. Import from `@katori/shared`, never deep paths.
- Every personal table has `profile_id`. Per-profile routes live under `/api/profiles/:pid/...`; the PIN preHandler in `app.ts` guards them.
- Totals, monthly views and body fat are computed on read (`services/totals.ts`, `services/progress.ts`). Don't store derived numbers.
- Dates are plain strings: `YYYY-MM-DD` and wall-clock `YYYY-MM-DDTHH:mm`. The phone sends its date in `x-katori-date`; use `todayOf(req)`.

## The AI call (don't loosen these)

- `ai/claude-runner.ts` runs the official `claude` binary with `execFile` and an argument array: fresh empty working folder holding only `meal.jpg`, `--tools Read`, `--json-schema`, `--permission-mode dontAsk`, `--no-session-persistence`, never `--bare`.
- Exactly one credential per job, from that profile's `<credentialsDir>/<profile>.env`; a profile never falls back to anyone else's sign-in. `KATORI_AMBIENT_AUTH_PROFILE` is a dev-only exception for the owner's own profile.
- MCP: only the local `search_food` tool, via `--mcp-config` + `--strict-mcp-config` + `--allowedTools`; otherwise `--disallowedTools mcp__*`.
- `schemas/meal-estimate.json` must not declare `$schema` (the CLI rejects the 2020-12 URI). A unit test keeps it in step with the Zod `MealEstimate`.
- Failures: classify by `api_error_status` first (401/403 → signed out, no retry; 429/529 → retry), then text. `claude auth status` only checks that a credential exists, so a rejected job is what flips a profile to "signed out".
- Fake runner (`KATORI_AI=fake`) is for tests; keep it deterministic.

## Formulas

All target and body-metric maths lives in `packages/shared/src/calc` as pure functions with unit tests. PLAN.md's worked example (26, male, 177.8 cm, 70 kg, lightly active, 0.25 kg/week → 2,044 kcal, 112 g protein) is a test; keep it passing.

## UI

- Mobile-first, phone width 393 px, no horizontal scroll. Every control has a label and a `data-testid` (Playwright's default test id).
- Colours are CSS variables in `styles.css`. Chart series use the validated palette slots in fixed order (kcal blue, protein orange, carbs aqua, fat yellow, fiber magenta); status colours only for on/over/under, always with a label. Every chart has a table view; no dual axes.

## Before saying something is done

```bash
npm run typecheck && npm test && npm run e2e
```

Then run the PLAN.md checklist in a real browser with Playwright MCP at iPhone size against `npm run test-server`, fix failures, and update TEST_REPORT.md with screenshots.

## Migrations

Change `apps/server/src/db/schema.ts`, then `npm run db:generate`, and commit the new file in `apps/server/drizzle/`. The server and `katori migrate` apply migrations on start.
