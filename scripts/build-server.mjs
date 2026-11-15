import { build } from 'esbuild'

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server/index.js',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  bundle: true,
  packages: 'external',
  sourcemap: true
})
