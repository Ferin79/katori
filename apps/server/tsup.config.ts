import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'ref-mcp': 'src/mcp/reference-server.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Bundle the workspace package (shipped as TypeScript source); keep real deps external.
  noExternal: ['@katori/shared'],
  banner: { js: '#!/usr/bin/env node' },
});
