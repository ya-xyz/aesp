import { defineConfig, type Plugin } from 'vite';
import path from 'path';
import fs from 'fs';

/**
 * Custom Vite plugin to resolve `.js` imports to `.ts` source files.
 * The SDK uses `.js` extensions in TypeScript imports (ESM convention).
 * In the Vite dev server, we need to resolve these to the actual `.ts` files.
 */
function resolveJsToTs(): Plugin {
  const srcRoot = path.resolve(__dirname, '../src');

  return {
    name: 'resolve-js-to-ts',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.endsWith('.js')) return null;

      // Only handle imports from the SDK source directory
      const importerDir = path.dirname(importer);
      const resolved = path.resolve(importerDir, source);

      // Check if the resolved path is under src/
      if (!resolved.startsWith(srcRoot)) return null;

      // Try replacing .js with .ts
      const tsPath = resolved.replace(/\.js$/, '.ts');
      if (fs.existsSync(tsPath)) {
        return tsPath;
      }

      return null;
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [resolveJsToTs()],
  resolve: {
    alias: {
      '@aesp': path.resolve(__dirname, '../src'),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
