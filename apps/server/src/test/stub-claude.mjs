// Stands in for the `claude` binary in tests. It records what it was given (argv, working folder,
// which credential variables were set) into CLAUDE_CONFIG_DIR/report.json and answers like
// `claude -p --output-format json` or `claude auth status` would.
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const env = process.env;
const report = {
  args,
  cwdFiles: readdirSync(process.cwd()),
  hasOauth: Boolean(env.CLAUDE_CODE_OAUTH_TOKEN),
  hasApiKey: Boolean(env.ANTHROPIC_API_KEY),
  configDir: env.CLAUDE_CONFIG_DIR ?? null,
  envKeys: Object.keys(env).sort(),
};
if (env.CLAUDE_CONFIG_DIR) writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, `report-${args[0] === 'auth' ? 'auth' : 'run'}.json`), JSON.stringify(report));

const signedIn = env.CLAUDE_CODE_OAUTH_TOKEN === 'sk-ant-oat01-good' || env.ANTHROPIC_API_KEY === 'sk-ant-api03-good';

if (args[0] === 'auth') {
  process.stdout.write(JSON.stringify({ loggedIn: signedIn, authMethod: signedIn ? 'oauth_token' : 'none' }));
  process.exit(signedIn ? 0 : 1);
}

if (!signedIn) {
  // The shape a real run printed for a rejected setup-token (live test, Claude Code 2.1.261).
  process.stdout.write(
    JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 401, num_turns: 1, result: 'Failed to authenticate. API Error: 401 OAuth access token is invalid.' }),
  );
  process.exit(1);
}

const structured = {
  items: [
    { name: 'Phulka roti', portion: '2 medium', grams: 70, kcal: 185, protein_g: 6, carbs_g: 35.4, fat_g: 1.8, fiber_g: 4.9, confidence: 'high', myFoodId: null, referenceId: null },
    { name: 'Dal', portion: '1 katori', grams: 150, kcal: 158, protein_g: 9.8, carbs_g: 23.3, fat_g: 1.8, fiber_g: 5.3, confidence: 'medium', myFoodId: '1', referenceId: null },
  ],
  questions: [],
};
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: structured }));
