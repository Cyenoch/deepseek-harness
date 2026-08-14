import { defineConfig } from 'tsdown'

/** Build Electron main as ESM and sandboxed preload as one self-contained CJS file. */
export default defineConfig([
  {
    entry: ['lib/types/src/main.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    outputOptions: { codeSplitting: false, entryFileNames: 'main.js' },
    deps: { neverBundle: ['electron'] },
    dts: false,
    clean: false,
  },
  {
    entry: ['lib/types/src/preload.js'],
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    outputOptions: { codeSplitting: false, entryFileNames: 'preload.cjs' },
    deps: {
      alwaysBundle: ['@deepseek-ai/dsh-client-connection/electron'],
      neverBundle: ['electron'],
    },
    dts: false,
    clean: false,
  },
])
