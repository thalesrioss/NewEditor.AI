import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { escolherFerramentas, type FerramentasEntrada } from './ferramentas';

const RES = '/Applications/Editor Brain.app/Contents/Resources';
const DESK = '/repo/apps/desktop';
const BREW = '/opt/homebrew/bin';
const NPM = { ffmpeg: '/app.asar.unpacked/ffmpeg-static/ffmpeg', ffprobe: '/app.asar.unpacked/ffprobe-static/ffprobe' };

function entrada(arquivos: string[], over: Partial<FerramentasEntrada> = {}): FerramentasEntrada {
  const set = new Set(arquivos);
  return {
    platform: 'darwin',
    arch: 'arm64',
    packaged: true,
    resourcesPath: RES,
    desktopDir: DESK,
    env: {},
    existe: (f) => set.has(f),
    noPath: (n) => (set.has(`${BREW}/${n}`) ? `${BREW}/${n}` : null),
    estaticoNpm: () => NPM,
    join: path.posix.join,
    ...over,
  };
}

test('ferramentas: Mac empacotado usa o FFmpeg 9 de dentro do app mesmo com Homebrew instalado', () => {
  const r = escolherFerramentas(entrada([`${RES}/ffmpeg/ffmpeg`, `${RES}/ffmpeg/ffprobe`, `${BREW}/ffmpeg`, `${BREW}/ffprobe`, NPM.ffmpeg, NPM.ffprobe]));
  assert.deepEqual(r, { ffmpeg: `${RES}/ffmpeg/ffmpeg`, ffprobe: `${RES}/ffmpeg/ffprobe`, origem: 'empacotado-9' });
});

test('ferramentas: em desenvolvimento procura vendor/ffmpeg/darwin-<arch>', () => {
  const dir = `${DESK}/vendor/ffmpeg/darwin-x64`;
  const r = escolherFerramentas(entrada([`${dir}/ffmpeg`, `${dir}/ffprobe`], { packaged: false, arch: 'x64' }));
  assert.equal(r.origem, 'empacotado-9');
  assert.equal(r.ffmpeg, `${dir}/ffmpeg`);
});

test('ferramentas: sem o par empacotado completo cai no Homebrew, nunca mistura versões', () => {
  const r = escolherFerramentas(entrada([`${RES}/ffmpeg/ffmpeg`, `${BREW}/ffmpeg`, `${BREW}/ffprobe`]));
  assert.deepEqual(r, { ffmpeg: `${BREW}/ffmpeg`, ffprobe: `${BREW}/ffprobe`, origem: 'path' });
});

test('ferramentas: variáveis de ambiente mandam', () => {
  const r = escolherFerramentas(entrada([`${RES}/ffmpeg/ffmpeg`, `${RES}/ffmpeg/ffprobe`], { env: { NEWEDITOR_FFMPEG: '/x/ffmpeg', NEWEDITOR_FFPROBE: '/x/ffprobe' } }));
  assert.deepEqual(r, { ffmpeg: '/x/ffmpeg', ffprobe: '/x/ffprobe', origem: 'ambiente' });
});

test('ferramentas: Windows usa o do PATH e, sem ele, o ffmpeg-static (ainda 6.0)', () => {
  const win = { platform: 'win32' as const, resourcesPath: 'C:/EB/resources' };
  assert.equal(escolherFerramentas(entrada([`${BREW}/ffmpeg.exe`, `${BREW}/ffprobe.exe`, NPM.ffmpeg, NPM.ffprobe], win)).origem, 'path');
  assert.equal(escolherFerramentas(entrada([NPM.ffmpeg, NPM.ffprobe], win)).origem, 'ffmpeg-static');
});

test('ferramentas: nada instalado devolve os nomes puros', () => {
  assert.deepEqual(escolherFerramentas(entrada([])), { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', origem: 'nenhuma' });
});
