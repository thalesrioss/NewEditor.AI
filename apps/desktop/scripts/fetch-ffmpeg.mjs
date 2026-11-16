// Baixa o FFmpeg e o ffprobe estáticos que o app de Mac leva dentro dele (a reserva quando a máquina não tem um
// FFmpeg igual ou mais novo). Versão e checksum fixos: o build só aceita exatamente estes arquivos.
// Fonte: ffmpeg.martin-riedl.de (builds estáticos, assinados e notarizados). Destino: vendor/ffmpeg/darwin-<arch>/.
//
//   node scripts/fetch-ffmpeg.mjs            → arquitetura desta máquina
//   node scripts/fetch-ffmpeg.mjs arm64 x64  → as duas
//
// O Windows ainda usa ffmpeg-static (6.0) até a build de Windows (decisão do Thales, 16/11/2026).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FFMPEG_VERSION = '9.0.2';
const BASE = 'https://ffmpeg.martin-riedl.de/download/macos';
/** Pasta de cada build e o SHA-256 de cada zip (conferidos com os .sha256 publicados ao lado). */
const BUILDS = {
  arm64: { dir: 'arm64/1789931890_9.0.2', sha: { ffmpeg: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924', ffprobe: 'fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6' } },
  x64: { dir: 'amd64/1789931006_9.0.2', sha: { ffmpeg: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4', ffprobe: '2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd' } },
};

const here = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.resolve(here, '..', 'vendor', 'ffmpeg');

function versionOf(bin) {
  try {
    return /version (\S+?)(?:-|\s)/.exec(execFileSync(bin, ['-version']).toString())?.[1] ?? null;
  } catch {
    return null;
  }
}

async function fetchOne(arch, tool) {
  const build = BUILDS[arch];
  const outDir = path.join(vendor, `darwin-${arch}`);
  const bin = path.join(outDir, tool);
  // Só dá para rodar o binário para conferir a versão na mesma arquitetura (ou x64 sob Rosetta).
  if (fs.existsSync(bin) && (versionOf(bin) === FFMPEG_VERSION || (arch !== process.arch && fs.statSync(bin).size > 0))) {
    console.log(`  ${arch} ${tool} ${FFMPEG_VERSION}: já está em ${path.relative(process.cwd(), bin)}`);
    return;
  }
  const url = `${BASE}/${build.dir}/${tool}.zip`;
  console.log(`  baixando ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  const sha = crypto.createHash('sha256').update(zip).digest('hex');
  if (sha !== build.sha[tool]) throw new Error(`${tool} ${arch}: checksum ${sha} não confere com o fixado (${build.sha[tool]}). Nada foi instalado.`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-ffmpeg-'));
  try {
    const zipFile = path.join(tmp, `${tool}.zip`);
    fs.writeFileSync(zipFile, zip);
    execFileSync('ditto', ['-x', '-k', zipFile, tmp]);
    const extracted = path.join(tmp, tool);
    if (!fs.existsSync(extracted)) throw new Error(`${tool}.zip não tem o executável ${tool}`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(extracted, bin);
    fs.chmodSync(bin, 0o755);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const v = arch === process.arch ? versionOf(bin) : FFMPEG_VERSION;
  if (v !== FFMPEG_VERSION) throw new Error(`${bin} diz versão ${v}, esperava ${FFMPEG_VERSION}`);
  console.log(`  ${arch} ${tool} ${FFMPEG_VERSION}: ok (${(fs.statSync(bin).size / 1048576).toFixed(1)} MB)`);
}

const pedidas = process.argv.slice(2);
if (!pedidas.length && process.platform !== 'darwin') {
  console.log('  fetch-ffmpeg: só o Mac leva o FFmpeg 9 por enquanto (o Windows usa ffmpeg-static).');
  process.exit(0);
}
const archs = pedidas.length ? pedidas : [process.arch];
for (const arch of archs) {
  if (!BUILDS[arch]) throw new Error(`arquitetura sem build fixado: ${arch} (use arm64 ou x64)`);
  for (const tool of ['ffmpeg', 'ffprobe']) await fetchOne(arch, tool);
}
