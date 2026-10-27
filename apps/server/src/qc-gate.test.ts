/**
 * FB-0180 A4: o qc-tecnico como gate do render. O arquivo fora do perfil (faixa cheia, sem etiquetas, 2997/100, como
 * as 55 entregas medidas) reprova, o laudo fica ao lado do render, e a assinatura do cliente vem de data/assinaturas.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-gate-'));
process.env.NEWEDITOR_DATA = path.join(tmp, 'data');
process.env.NEWEDITOR_LLM = 'off';
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const { assinaturaDoCliente, gateTecnico } = await import('./qc-gate.ts');

test('assinatura do cliente: a da pasta de dados manda, senão a que vem com o produto', async () => {
  const p = { name: 'eq', client: 'Equity Sales', assets: [] } as never;
  assert.equal((await assinaturaDoCliente(p))?.satavg, 8.32);
  fs.mkdirSync(path.join(tmp, 'data', 'assinaturas'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'data', 'assinaturas', 'equity-sales.json'), JSON.stringify({ satavg: 5, fonte: 'teste' }));
  assert.equal((await assinaturaDoCliente(p))?.satavg, 5);
  assert.equal(await assinaturaDoCliente({ name: 'x', client: 'Outro', assets: [] } as never), undefined);
});

test('entrega fora do perfil reprova e o laudo fica ao lado do render', { timeout: 60_000 }, async () => {
  const f = path.join(tmp, 'peca_v001.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=108x192:r=29.97:d=2', '-f', 'lavfi', '-i', 'sine=f=300:r=48000:d=2', '-vf', 'format=yuvj420p', '-c:v', 'libx264', '-color_range', 'pc', '-c:a', 'aac', '-shortest', f]);
  const p = { name: 'peca', assets: [], timeline: { fps: 29.97, main: [], overlays: [], removals: [], tracks: [], width: 108, height: 192 } } as never;
  const r = await gateTecnico(p, f);
  assert.equal(r.aprovado, false);
  const laudo = fs.readFileSync(path.join(tmp, 'peca_v001.qc-tecnico.txt'), 'utf8');
  assert.match(laudo, /^REPROVADO/);
  assert.ok(r.achados.some((a) => !a.ok && /faixa|range/i.test(a.regra + a.medido)), JSON.stringify(r.achados.filter((a) => !a.ok).map((a) => a.regra)));
});
