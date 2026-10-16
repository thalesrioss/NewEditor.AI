/**
 * Demuxer MP4 mínimo para o motor de preview (ADR-005): lê o `moov` e devolve, por trilha, o codec, a
 * configuração do decodificador (avcC / AudioSpecificConfig) e a tabela de amostras — posição no arquivo,
 * tamanho, tempos (s) e quadro-chave. Com isso o navegador busca só os bytes de que precisa (HTTP Range) e
 * entrega ao WebCodecs. Feito para os nossos proxies (H.264/AAC, faststart), sem dependência externa.
 */

export interface Mp4Sample {
  /** Posição no arquivo e tamanho em bytes. */
  offset: number;
  size: number;
  /** Tempo de decodificação e de apresentação, em segundos (já com a lista de edição aplicada). */
  dts: number;
  pts: number;
  dur: number;
  key: boolean;
}

export interface Mp4Track {
  id: number;
  kind: 'video' | 'audio';
  codec: string;
  /** avcC (vídeo) ou AudioSpecificConfig (áudio): o `description` do WebCodecs. */
  description: Uint8Array;
  timescale: number;
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
  /** Em ordem de decodificação. */
  samples: Mp4Sample[];
  duration: number;
}

interface Box {
  type: string;
  start: number;
  /** Início do conteúdo (depois do cabeçalho). */
  body: number;
  end: number;
}

function boxes(v: DataView, from: number, to: number): Box[] {
  const out: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = v.getUint32(p);
    const type = String.fromCharCode(v.getUint8(p + 4), v.getUint8(p + 5), v.getUint8(p + 6), v.getUint8(p + 7));
    let body = p + 8;
    if (size === 1) {
      size = Number(v.getBigUint64(p + 8));
      body = p + 16;
    } else if (size === 0) size = to - p;
    if (size < 8) break;
    out.push({ type, start: p, body, end: Math.min(to, p + size) });
    p += size;
  }
  return out;
}
const child = (v: DataView, b: Box | undefined, type: string, skip = 0) => (b ? boxes(v, b.body + skip, b.end).find((x) => x.type === type) : undefined);

/** Acha o `moov` entre as caixas do topo do arquivo (para o faststart, ele vem logo depois do `ftyp`). */
export function findMoov(head: Uint8Array): { offset: number; size: number } | null {
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
  let p = 0;
  while (p + 8 <= head.byteLength) {
    let size = v.getUint32(p);
    const type = String.fromCharCode(head[p + 4]!, head[p + 5]!, head[p + 6]!, head[p + 7]!);
    if (size === 1 && p + 16 <= head.byteLength) size = Number(v.getBigUint64(p + 8));
    if (type === 'moov') return { offset: p, size };
    if (size < 8) return null;
    p += size;
  }
  return null;
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** Codec string do HEVC a partir do hvcC (ISO/IEC 14496-15, anexo E), ex.: "hvc1.4.10.L153.B0". */
function hevcCodec(sampleEntry: string, c: Uint8Array): string {
  const space = c[1]! >> 6;
  const tier = (c[1]! >> 5) & 1;
  const profile = c[1]! & 31;
  // Flags de compatibilidade com a ordem dos bits invertida, em hex sem zeros à esquerda.
  const flags = ((c[2]! << 24) | (c[3]! << 16) | (c[4]! << 8) | c[5]!) >>> 0;
  let rev = 0;
  for (let i = 0; i < 32; i++) if (flags & (1 << i)) rev |= 1 << (31 - i);
  const cons = [...c.subarray(6, 12)];
  while (cons.length && cons[cons.length - 1] === 0) cons.pop();
  return [`${sampleEntry === 'hev1' ? 'hev1' : 'hvc1'}`, `${space ? 'ABC'[space - 1] : ''}${profile}`, (rev >>> 0).toString(16), `${tier ? 'H' : 'L'}${c[12]}`, ...cons.map((b) => b.toString(16).toUpperCase())].join('.');
}

/** Lê um descritor do esds (tag + tamanho de 1–4 bytes de 7 bits). */
function descriptor(v: DataView, p: number): { tag: number; body: number; size: number } {
  const tag = v.getUint8(p);
  let size = 0;
  let q = p + 1;
  for (let k = 0; k < 4; k++) {
    const b = v.getUint8(q++);
    size = (size << 7) | (b & 0x7f);
    if (!(b & 0x80)) break;
  }
  return { tag, body: q, size };
}

/** `moov` = bytes da caixa moov inteira; `moovOffset` = onde ela começa no arquivo (as posições de amostra são absolutas). */
export function parseMp4(moov: Uint8Array): Mp4Track[] {
  const v = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const root = boxes(v, 0, moov.byteLength).find((b) => b.type === 'moov');
  if (!root) throw new Error('mp4: sem moov');
  const mvhd = child(v, root, 'mvhd');
  const movieScale = mvhd ? v.getUint32(mvhd.body + (v.getUint8(mvhd.body) === 1 ? 20 : 12)) : 1000;
  const tracks: Mp4Track[] = [];

  for (const trak of boxes(v, root.body, root.end).filter((b) => b.type === 'trak')) {
    const tkhd = child(v, trak, 'tkhd');
    const id = tkhd ? v.getUint32(tkhd.body + (v.getUint8(tkhd.body) === 1 ? 20 : 12)) : tracks.length + 1;
    const mdia = child(v, trak, 'mdia');
    const mdhd = child(v, mdia, 'mdhd');
    const hdlr = child(v, mdia, 'hdlr');
    if (!mdhd || !hdlr) continue;
    const v1 = v.getUint8(mdhd.body) === 1;
    const timescale = v.getUint32(mdhd.body + (v1 ? 20 : 12));
    const handler = String.fromCharCode(...[0, 1, 2, 3].map((k) => v.getUint8(hdlr.body + 8 + k)));
    if (handler !== 'vide' && handler !== 'soun') continue;
    const stbl = child(v, child(v, mdia, 'minf'), 'stbl');
    if (!stbl) continue;

    // --- Descrição do codec ---------------------------------------------------------------
    const stsd = child(v, stbl, 'stsd');
    if (!stsd) continue;
    const entry = boxes(v, stsd.body + 8, stsd.end)[0];
    if (!entry) continue;
    let codec = '';
    let description = new Uint8Array();
    const t: Partial<Mp4Track> = {};
    if (handler === 'vide') {
      t.width = v.getUint16(entry.body + 24);
      t.height = v.getUint16(entry.body + 26);
      const cfg = boxes(v, entry.body + 78, entry.end).find((b) => b.type === 'avcC' || b.type === 'hvcC');
      if (!cfg) continue;
      description = moov.slice(cfg.body, cfg.end);
      codec = cfg.type === 'avcC' ? `avc1.${hex2(description[1]!)}${hex2(description[2]!)}${hex2(description[3]!)}` : hevcCodec(entry.type, description);
    } else {
      t.channels = v.getUint16(entry.body + 16);
      t.sampleRate = v.getUint32(entry.body + 24) >>> 16;
      const esds = boxes(v, entry.body + 28, entry.end).find((b) => b.type === 'esds');
      if (!esds) continue;
      // ES_Descriptor (3) → DecoderConfigDescriptor (4) → DecoderSpecificInfo (5)
      let d = descriptor(v, esds.body + 4);
      if (d.tag !== 3) continue;
      let p = d.body + 3;
      const flags = v.getUint8(d.body + 2);
      if (flags & 0x80) p += 2;
      if (flags & 0x40) p += 1 + v.getUint8(p);
      if (flags & 0x20) p += 2;
      d = descriptor(v, p);
      if (d.tag !== 4) continue;
      const dsi = descriptor(v, d.body + 13);
      if (dsi.tag !== 5) continue;
      description = moov.slice(dsi.body, dsi.body + dsi.size);
      codec = `mp4a.40.${description[0]! >> 3}`;
    }

    // --- Tabela de amostras ---------------------------------------------------------------
    const u32s = (b: Box | undefined, skip: number, per: number) => {
      if (!b) return null;
      const n = v.getUint32(b.body + 4);
      const out: number[][] = [];
      for (let i = 0; i < n; i++) {
        const row: number[] = [];
        for (let k = 0; k < per; k++) row.push(v.getUint32(b.body + skip + (i * per + k) * 4));
        out.push(row);
      }
      return out;
    };
    const stsz = child(v, stbl, 'stsz')!;
    const fixed = v.getUint32(stsz.body + 4);
    const count = v.getUint32(stsz.body + 8);
    const sizes = Array.from({ length: count }, (_, i) => (fixed ? fixed : v.getUint32(stsz.body + 12 + i * 4)));
    const stts = u32s(child(v, stbl, 'stts'), 8, 2) ?? [];
    const cttsBox = child(v, stbl, 'ctts');
    const ctts = cttsBox ? (u32s(cttsBox, 8, 2) ?? []).map(([n, off]) => [n!, v.getUint8(cttsBox.body) === 1 ? off! | 0 : off!]) : [];
    const stssBox = child(v, stbl, 'stss');
    const sync = stssBox ? new Set((u32s(stssBox, 8, 1) ?? []).map((r) => r[0]! - 1)) : null;
    const stsc = u32s(child(v, stbl, 'stsc'), 8, 3) ?? [];
    const stco = child(v, stbl, 'stco');
    const co64 = child(v, stbl, 'co64');
    const chunks: number[] = [];
    if (stco) for (let i = 0, n = v.getUint32(stco.body + 4); i < n; i++) chunks.push(v.getUint32(stco.body + 8 + i * 4));
    else if (co64) for (let i = 0, n = v.getUint32(co64.body + 4); i < n; i++) chunks.push(Number(v.getBigUint64(co64.body + 8 + i * 8)));

    // Lista de edição: o primeiro trecho de mídia define onde o tempo zero de apresentação cai.
    let shift = 0;
    const elst = child(v, child(v, trak, 'edts'), 'elst');
    if (elst) {
      const ev1 = v.getUint8(elst.body) === 1;
      const n = v.getUint32(elst.body + 4);
      let empty = 0;
      for (let i = 0, p = elst.body + 8; i < n; i++, p += ev1 ? 20 : 12) {
        const segDur = ev1 ? Number(v.getBigUint64(p)) : v.getUint32(p);
        const mediaTime = ev1 ? Number(v.getBigInt64(p + 8)) : v.getInt32(p + 4);
        if (mediaTime === -1) empty += segDur / movieScale;
        else {
          shift = empty - mediaTime / timescale;
          break;
        }
      }
    }

    const samples: Mp4Sample[] = [];
    let si = 0;
    let dts = 0;
    let sttsRow = 0;
    let sttsLeft = stts[0]?.[0] ?? 0;
    let cttsRow = 0;
    let cttsLeft = ctts[0]?.[0] ?? 0;
    for (let c = 0; c < chunks.length && si < count; c++) {
      // stsc: a última entrada cujo first_chunk ≤ c+1 define quantas amostras tem este chunk.
      let per = stsc[0]?.[1] ?? 1;
      for (const [first, n] of stsc) if (first! <= c + 1) per = n!;
      let off = chunks[c]!;
      for (let k = 0; k < per && si < count; k++, si++) {
        while (sttsLeft === 0 && sttsRow < stts.length - 1) sttsLeft = stts[++sttsRow]![0]!;
        const delta = stts[sttsRow]?.[1] ?? 0;
        while (ctts.length && cttsLeft === 0 && cttsRow < ctts.length - 1) cttsLeft = ctts[++cttsRow]![0]!;
        const cto = ctts.length ? ctts[cttsRow]![1]! : 0;
        samples.push({ offset: off, size: sizes[si]!, dts: dts / timescale + shift, pts: (dts + cto) / timescale + shift, dur: delta / timescale, key: sync ? sync.has(si) : true });
        off += sizes[si]!;
        dts += delta;
        sttsLeft--;
        if (ctts.length) cttsLeft--;
      }
    }
    tracks.push({ id, kind: handler === 'vide' ? 'video' : 'audio', codec, description, timescale, samples, duration: dts / timescale, ...t });
  }
  return tracks;
}
