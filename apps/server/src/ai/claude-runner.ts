// Runs the official `claude` binary headless, once per meal, exactly as PLAN.md "The call" says:
// execFile with an argument array (no shell), a fresh empty working folder per meal holding only
// meal.jpg, --tools "Read", --json-schema, a 2-minute timeout, and one credential per job.
import { execFile, type ExecFileException } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MealEstimate } from '@katori/shared';
import type { Config } from '../config.js';
import { SERVER_ROOT } from '../config.js';
import { buildJobEnv, readCredential } from '../services/credentials.js';
import { buildSystemPrompt, buildUserPrompt, PHOTO_NAME } from './prompt.js';
import {
  RunnerError,
  type EstimateRequest,
  type EstimateResult,
  type ProfileRow,
  type RecapRequest,
  type RecapResult,
  type Runner,
  type RunnerErrorKind,
  type RunMeta,
} from './runner.js';

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  spawnError: string | null;
  durationMs: number;
}

function exec(bin: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<ExecResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = execFile(
      bin,
      args,
      { cwd: opts.cwd, env: opts.env, timeout: opts.timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err: ExecFileException | null, stdout, stderr) => {
        const durationMs = Date.now() - started;
        if (!err) return resolve({ stdout, stderr, code: 0, timedOut: false, spawnError: null, durationMs });
        resolve({
          stdout,
          stderr,
          code: typeof err.code === 'number' ? err.code : null,
          timedOut: Boolean(err.killed) && durationMs >= opts.timeoutMs - 50,
          spawnError: typeof err.code === 'string' ? err.code : null,
          durationMs,
        });
      },
    );
    child.stdin?.end();
  });
}

const AUTH_PATTERNS = /(invalid api key|not logged in|please run \/login|run \/login|authentication_error|failed to authenticate|access token is invalid|invalid bearer|oauth token (has )?expired|token expired|api error: 40[13]|"loggedin":\s*false)/i;
const LIMIT_PATTERNS = /(usage limit|rate[ _]limit|\b429\b|overloaded|\b529\b|limit reached|resets at)/i;
/** The call itself is wrong (a bad flag or schema): retrying can't help. */
const CONFIG_PATTERNS = /(not a valid json schema|unknown option|error: option .* argument|invalid value for)/i;

interface ClaudeJsonResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  /** HTTP status of a failed API call, e.g. 401 for a rejected token. */
  api_error_status?: number;
}

/** Turn a failed run into a RunnerError: the structured API status first, then the text. */
function failure(result: ClaudeJsonResult | null, r: ExecResult, meta: Partial<RunMeta>): RunnerError {
  const detail = (result?.result || r.stderr || r.stdout || `exit ${r.code ?? '?'}`).trim();
  const status = result?.api_error_status;
  const text = [detail, r.stderr].join('\n');
  const kind: RunnerErrorKind =
    status === 401 || status === 403 ? 'auth' : status === 429 || status === 529 ? 'usage_limit' : AUTH_PATTERNS.test(text) ? 'auth' : LIMIT_PATTERNS.test(text) ? 'usage_limit' : CONFIG_PATTERNS.test(text) ? 'config' : 'error';
  const message =
    kind === 'auth'
      ? `Signed out: the Claude credential for this profile was rejected (${tail(detail, 120)}).`
      : kind === 'usage_limit'
        ? `Plan usage limit reached (${tail(detail, 120)}); will retry.`
        : `Claude Code failed (exit ${r.code ?? '?'}): ${tail(detail, 300)}`;
  return new RunnerError(kind, message, kind !== 'auth' && kind !== 'config', meta);
}

/** --output-format json prints one result object; tolerate stray lines around it. */
function parseResult(stdout: string): ClaudeJsonResult | null {
  const trimmed = stdout.trim();
  const candidates = [trimmed, ...trimmed.split(/\r?\n/).reverse()];
  for (const c of candidates) {
    if (!c.startsWith('{')) continue;
    try {
      const obj = JSON.parse(c) as ClaudeJsonResult;
      if (obj && typeof obj === 'object') return obj;
    } catch {
      // keep looking
    }
  }
  return null;
}

const tail = (s: string, n = 600) => (s.length > n ? '…' + s.slice(-n) : s);

export class ClaudeRunner implements Runner {
  readonly mode = 'claude' as const;
  private basePrompt: string;
  private schema: string;

  constructor(private cfg: Config) {
    this.basePrompt = readFileSync(cfg.promptFile, 'utf8');
    // Compact the schema so it travels as one argv entry.
    this.schema = JSON.stringify(JSON.parse(readFileSync(cfg.schemaFile, 'utf8')));
  }

  private envFor(profile: ProfileRow): NodeJS.ProcessEnv {
    const ambient = this.cfg.ambientAuthProfile === profile.id;
    if (profile.aiAccess === 'manual') throw new RunnerError('no_access', 'This profile is set to manual logging (no AI).', false);
    const credential = ambient ? null : readCredential(this.cfg, profile.id);
    if (!ambient && !credential) {
      throw new RunnerError('auth', `No AI credential for this profile. On the server run: katori set-credential ${profile.id}`, false);
    }
    if (credential) {
      const expected = profile.aiAccess === 'sign_in' ? 'oauth' : 'api_key';
      if (credential.type !== expected) {
        throw new RunnerError('auth', `This profile is set to ${profile.aiAccess === 'sign_in' ? 'Claude sign-in' : 'API key'} but its credential file holds the other kind.`, false);
      }
    }
    return buildJobEnv(this.cfg, { profileId: profile.id, credential, ambient });
  }

  private refMcpCommand(): { command: string; args: string[] } {
    const dist = path.join(SERVER_ROOT, 'dist', 'ref-mcp.js');
    const runningFromSource = fileURLToPath(import.meta.url).endsWith('.ts');
    if (!runningFromSource && existsSync(dist)) return { command: process.execPath, args: [dist] };
    return { command: process.execPath, args: ['--import', 'tsx', path.join(SERVER_ROOT, 'src', 'mcp', 'reference-server.ts')] };
  }

  async estimate(req: EstimateRequest): Promise<EstimateResult> {
    const env = this.envFor(req.profile);
    const runDir = path.join(this.cfg.jobsDir, `${Date.now()}-${randomUUID().slice(0, 8)}`);
    const workDir = path.join(runDir, 'work'); // holds only meal.jpg
    mkdirSync(workDir, { recursive: true });
    const model = req.settings.model;
    try {
      if (req.photoPath) copyFileSync(req.photoPath, path.join(workDir, PHOTO_NAME));
      const systemFile = path.join(runDir, 'system-prompt.md');
      writeFileSync(systemFile, buildSystemPrompt(this.basePrompt, req));

      const args = ['-p', buildUserPrompt({ hasPhoto: Boolean(req.photoPath), note: req.note, answers: req.answers }), '--model', model, '--tools', 'Read'];
      if (req.referenceLookup) {
        const mcpFile = path.join(runDir, 'mcp.json');
        const { command, args: mcpArgs } = this.refMcpCommand();
        writeFileSync(
          mcpFile,
          JSON.stringify({ mcpServers: { katori_ref: { type: 'stdio', command, args: mcpArgs, env: { KATORI_DB: this.cfg.dbPath } } } }),
        );
        // Only the lookup tool: strict config, and the blanket MCP deny is dropped.
        args.push('--mcp-config', mcpFile, '--strict-mcp-config', '--allowedTools', 'Read', 'mcp__katori_ref__search_food');
      } else {
        args.push('--disallowedTools', 'mcp__*');
      }
      args.push(
        '--permission-mode', 'dontAsk',
        '--append-system-prompt-file', systemFile,
        '--output-format', 'json',
        '--json-schema', this.schema,
        '--max-turns', req.referenceLookup ? '10' : '4',
        '--no-session-persistence',
      );

      // Lookups add tool turns: a live run with them took ~107 s, so they get twice the budget.
      const timeoutMs = req.referenceLookup ? this.cfg.jobTimeoutMs * 2 : this.cfg.jobTimeoutMs;
      const r = await exec(this.cfg.claudeBin, [...this.cfg.claudeBinArgs, ...args], { cwd: workDir, env, timeoutMs });
      const meta = { durationMs: r.durationMs, exitCode: r.code, model, raw: tail(r.stdout || r.stderr, 20_000) };
      if (r.spawnError) throw new RunnerError('error', `Could not start ${this.cfg.claudeBin}: ${r.spawnError}`, false, meta);
      if (r.timedOut) throw new RunnerError('timeout', `Timed out after ${Math.round(timeoutMs / 1000)} s`, true, meta);

      const result = parseResult(r.stdout);
      if (!result || r.code !== 0 || result.is_error) throw failure(result, r, meta);
      const parsed = MealEstimate.safeParse(result.structured_output);
      if (!parsed.success) {
        throw new RunnerError('invalid_output', `Estimate did not match the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`, true, meta);
      }
      return { ...meta, estimate: parsed.data };
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  }

  async recap(req: RecapRequest): Promise<RecapResult> {
    const env = this.envFor(req.profile);
    const runDir = path.join(this.cfg.jobsDir, `${Date.now()}-recap-${randomUUID().slice(0, 8)}`);
    mkdirSync(runDir, { recursive: true });
    try {
      const prompt = [
        `Write ${req.profile.name}'s monthly recap for ${req.month} from these numbers from their calorie tracker.`,
        'Four to six short sentences, warm and plain, second person. Lead with the weight or waist trend, then intake vs target, protein, and one concrete, easy suggestion for next month based on the top contributors.',
        'Do not invent numbers; use only these. No headings, no lists, no emoji.',
        '',
        req.summary,
      ].join('\n');
      const args = ['-p', prompt, '--model', req.model, '--tools', '', '--disallowedTools', 'mcp__*', '--permission-mode', 'dontAsk', '--output-format', 'json', '--max-turns', '2', '--no-session-persistence'];
      const r = await exec(this.cfg.claudeBin, [...this.cfg.claudeBinArgs, ...args], { cwd: runDir, env, timeoutMs: this.cfg.jobTimeoutMs });
      const meta = { durationMs: r.durationMs, exitCode: r.code, model: req.model, raw: tail(r.stdout || r.stderr, 20_000) };
      if (r.spawnError) throw new RunnerError('error', `Could not start ${this.cfg.claudeBin}: ${r.spawnError}`, false, meta);
      if (r.timedOut) throw new RunnerError('timeout', 'Recap timed out', true, meta);
      const result = parseResult(r.stdout);
      if (!result || r.code !== 0 || result.is_error || !result.result) throw failure(result, r, meta);
      return { ...meta, text: result.result.trim() };
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  }

  async authStatus(profile: ProfileRow): Promise<{ ok: boolean; message: string }> {
    let env: NodeJS.ProcessEnv;
    try {
      env = this.envFor(profile);
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
    const cwd = path.join(this.cfg.jobsDir, 'auth');
    mkdirSync(cwd, { recursive: true });
    const r = await exec(this.cfg.claudeBin, [...this.cfg.claudeBinArgs, 'auth', 'status'], { cwd, env, timeoutMs: 30_000 });
    if (r.spawnError) return { ok: false, message: `Could not start ${this.cfg.claudeBin}: ${r.spawnError}` };
    if (r.code === 0) {
      let method = '';
      try {
        method = (JSON.parse(r.stdout) as { authMethod?: string }).authMethod ?? '';
      } catch {
        // text output
      }
      return { ok: true, message: method ? `Signed in (${method})` : 'Signed in' };
    }
    return { ok: false, message: 'Signed out: claude auth status reports no valid login for this profile.' };
  }
}
