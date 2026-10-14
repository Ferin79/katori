import type { FastifyBaseLogger } from 'fastify';
import type { Runner } from './ai/runner.js';
import type { Config } from './config.js';
import type { DB } from './db/client.js';
import type { AuthMonitor } from './services/auth-status.js';
import type { JobQueue } from './ai/queue.js';

export type Logger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error' | 'debug'>;

export interface Ctx {
  db: DB;
  cfg: Config;
  runner: Runner;
  queue: JobQueue;
  auth: AuthMonitor;
  log: Logger;
}
