import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, context } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

const entries = {
  background: resolve(root, 'src/background.ts'),
  content: resolve(root, 'src/content.ts'),
};

async function copyStaticFiles() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(resolve(root, 'manifest.json'), resolve(out, 'manifest.json'));
  await cp(resolve(root, 'src/popup'), resolve(out), { recursive: true });
  await cp(resolve(root, 'src/settings'), resolve(out), { recursive: true });
  await cp(resolve(root, 'src/styles'), resolve(out), { recursive: true });
}

await copyStaticFiles();

const options = {
  entryPoints: entries,
  outdir: out,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'firefox140',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching TypeScript entries. Re-run the build after changing static files.');
} else {
  await build(options);
  console.log('Built extension into dist/.');
}
