import { defineConfig } from 'vitest/config';

// Load migrations/*.sql as text in tests, the same way wrangler bundles them for the Worker.
export default defineConfig({
  plugins: [{
    name: 'sql-as-text',
    enforce: 'pre',
    transform(code: string, id: string) {
      return id.endsWith('.sql') ? { code: `export default ${JSON.stringify(code)};`, map: null } : undefined;
    },
  }],
});
