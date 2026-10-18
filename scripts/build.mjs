import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, context } from 'esbuild';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

const entries = {
  background: './src/background.ts',
  content: './src/content.ts',
  popup: './src/popup/popup.ts',
  settings: './src/settings/settings.ts',
};

async function compileSchema(schemaFilename, validatorFilename) {
  const schemaPath = resolve(root, schemaFilename);
  const schemaText = (await readFile(schemaPath, 'utf8')).replace(/^\uFEFF/, '');
  const schema = JSON.parse(schemaText);
  const ajv = new Ajv2020({ allErrors: true, strict: false, code: { source: true, esm: true } });
  const validate = ajv.compile(schema);
  const generated = standaloneCode(ajv, validate);
  const generatedDir = resolve(root, 'src/generated');
  await mkdir(generatedDir, { recursive: true });
  await writeFile(resolve(generatedDir, validatorFilename), generated, 'utf8');
}

async function copyStaticFiles() {
  await mkdir(out, { recursive: true });
  for (const entry of await readdir(out)) {
    await rm(resolve(out, entry), { recursive: true, force: true });
  }
  await cp(resolve(root, 'manifest.json'), resolve(out, 'manifest.json'));
  await cp(resolve(root, 'src/popup/popup.html'), resolve(out, 'popup.html'));
  await cp(resolve(root, 'src/settings/settings.html'), resolve(out, 'settings.html'));
  await cp(resolve(root, 'src/styles'), resolve(out), { recursive: true });
  await cp(resolve(root, 'template.json'), resolve(out, 'answers-sample.json'));
  await cp(resolve(root, 'work-history.template.json'), resolve(out, 'work-history-sample.json'));
}

await compileSchema('answers.schema.json', 'answers-validator.js');
await compileSchema('work-history.schema.json', 'work-history-validator.js');
await copyStaticFiles();

const options = {
  absWorkingDir: root,
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
  console.log('Watching TypeScript entries. Re-run the build after changing static files or the answer schema.');
} else {
  await build(options);
  console.log('Built extension into dist/.');
}
