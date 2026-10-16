// Empacota o processo principal do Electron e o servidor (TypeScript do monorepo) em dois arquivos ESM.
// As dependências do node_modules ficam de fora (o electron-builder leva as do package.json).
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const banner = `import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);`;
// Pacotes do monorepo entram no bundle (fora do repositório não existe node_modules/@neweditor/*); o resto fica externo.
const alias = { '@neweditor/core': path.join(root, 'packages/core/src/index.ts') };

await build({
  entryPoints: [path.join(here, 'src/main.ts')],
  outfile: path.join(here, 'dist/main.mjs'),
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
