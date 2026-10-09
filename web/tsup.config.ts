import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts', react: 'src/react.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2020',
    external: ['react'],
  },
  {
    // Plain <script> build: exposes window.StringCast
    entry: { stringcast: 'src/index.ts' },
    format: ['iife'],
    globalName: 'StringCast',
    minify: true,
    sourcemap: true,
    target: 'es2018',
  },
]);
