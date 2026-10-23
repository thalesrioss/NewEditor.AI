// Empacota o processo principal do Electron e o servidor (TypeScript do monorepo) em dois arquivos ESM.
// As dependências do node_modules ficam de fora (o electron-builder leva as do package.json).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const banner = `import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);`;
// Pacotes do monorepo entram no bundle (fora do repositório não existe node_modules/@neweditor/*); o resto fica externo.
const alias = { '@neweditor/core': path.join(root, 'packages/core/src/index.ts') };
// Commit do build, para "Sobre o Editor Brain" (FB-0169: saber de cara se o app instalado está atrasado).
let commit = 'sem git';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) commit += '+alterado';
} catch {
  /* fora de um repositório */
}

await build({
  entryPoints: [path.join(here, 'src/main.ts')],
  outfile: path.join(here, 'dist/main.mjs'),
  bundle: true,
  define: { __NEWEDITOR_COMMIT__: JSON.stringify(commit) },
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  alias,
  banner: { js: banner },
  sourcemap: true,
  logLevel: 'info',
});

await build({
  entryPoints: [path.join(root, 'apps/server/src/index.ts')],
  outfile: path.join(here, 'dist/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  alias,
  banner: { js: banner },
  sourcemap: true,
  logLevel: 'info',
});
