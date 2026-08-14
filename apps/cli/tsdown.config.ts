import { defineConfig } from 'tsdown'

/** Build the CLI bin and the Electron-consumable profile boot as independent entries. */
export default defineConfig([
  {
    entry: ['lib/types/bin.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    outputOptions: { codeSplitting: false },
    dts: false,
    clean: false,
  },
  {
    entry: ['lib/types/profile-boot.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    outputOptions: { codeSplitting: false },
    dts: false,
    clean: false,
  },
])
