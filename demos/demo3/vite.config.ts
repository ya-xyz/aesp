import { defineConfig, type Plugin } from 'vite';
import path from 'path';
import fs from 'fs';

function resolveJsToTs(): Plugin {
  const srcRoot = path.resolve(__dirname, '../src');

  return {
    name: 'resolve-js-to-ts',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.endsWith('.js')) return null;
      const importerDir = path.dirname(importer);
      const resolved = path.resolve(importerDir, source);
      if (!resolved.startsWith(srcRoot)) return null;
      const tsPath = resolved.replace(/\.js$/, '.ts');
      if (fs.existsSync(tsPath)) return tsPath;
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
    port: 5175,
    host: '127.0.0.1',
    open: false,
  },
});
