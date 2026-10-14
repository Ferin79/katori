import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const cfg = loadConfig();
const { app, ctx } = await buildApp(cfg);

await app.listen({ host: cfg.host, port: cfg.port });
app.log.info(`Katori on http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port} · AI: ${ctx.runner.mode} · DB: ${cfg.dbPath}`);

ctx.queue.start(); // resumes jobs left pending by a restart
ctx.auth.start(); // claude auth status per profile now and nightly

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    app.log.info(`${sig}: shutting down`);
    void app.close().then(() => process.exit(0));
  });
}
