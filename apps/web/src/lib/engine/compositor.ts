/**
 * Compositor WebGL2 único do preview (ADR-005): fala (com zoom), B-roll e o LUT de cor de cada arquivo num canvas
 * só, com o MESMO enquadramento do export:
 *  - fala: zoom = recorte central (crop iw/z), depois "contain" no quadro (letterbox);
 *  - B-roll: "cover" (preenche e recorta).
 */
import { buildLut, isNeutral, type ColorGrade, type CubeLut, textureOf } from '@neweditor/core';

const N = 33;

const VERT = `#version 300 es
in vec2 p;
uniform vec4 rect; // x0,y0,x1,y1 em clip space
uniform vec4 uvr;  // u0,v0,u1,v1
uniform float rot; // quartos de volta no sentido horário (vídeo de celular/câmera girada)
out vec2 uv;
void main() {
  vec2 q = (p + 1.0) * 0.5;
  vec2 d = vec2(q.x, 1.0 - q.y);
  vec2 s = rot < 0.5 ? d : rot < 1.5 ? vec2(d.y, 1.0 - d.x) : rot < 2.5 ? 1.0 - d : vec2(1.0 - d.y, d.x);
  uv = vec2(mix(uvr.x, uvr.z, s.x), mix(uvr.y, uvr.w, s.y));
  gl_Position = vec4(mix(rect.x, rect.z, q.x), mix(rect.y, rect.w, q.y), 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 color;
uniform sampler2D frame; uniform sampler3D lut; uniform float useLut;
uniform vec3 tex;    // nitidez, vinheta, grão (0..1) — os mesmos valores do unsharp/vignette/noise do FFmpeg
uniform vec2 texel;  // 1/largura, 1/altura do quadro
uniform vec2 res;    // tamanho do canvas
uniform float seed;  // muda a cada quadro: grão vivo
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed * 43758.5453) * 43758.5453); }
void main() {
  vec3 c = clamp(texture(frame, uv).rgb, 0.0, 1.0);
  if (tex.x > 0.0) {
    vec3 b = (texture(frame, uv + vec2(texel.x, 0.0)).rgb + texture(frame, uv - vec2(texel.x, 0.0)).rgb + texture(frame, uv + vec2(0.0, texel.y)).rgb + texture(frame, uv - vec2(0.0, texel.y)).rgb) * 0.25;
    c = clamp(c + (c - b) * tex.x * 1.6, 0.0, 1.0);
  }
  if (useLut > 0.5) c = texture(lut, c * ${((N - 1) / N).toFixed(6)} + ${(0.5 / N).toFixed(6)}).rgb;
  if (tex.y > 0.0) {
    vec2 q = (gl_FragCoord.xy / res - 0.5) * vec2(res.x / res.y, 1.0);
    float d = length(q) / 0.7071;
    c *= 1.0 - tex.y * smoothstep(0.45, 1.25, d);
  }
  if (tex.z > 0.0) c = clamp(c + (hash(gl_FragCoord.xy) - 0.5) * tex.z * 0.16, 0.0, 1.0);
  color = vec4(c, 1.0);
}`;

export interface Layer {
  frame: VideoFrame;
  fit: 'contain' | 'cover' | 'reframe';
  zoom?: number;
  grade?: ColorGrade | null;
  /** Rotação de exibição do arquivo, em graus no sentido horário (o quadro decodificado vem sem girar). */
  rotate?: 0 | 90 | 180 | 270;
  /** Reframe: centro horizontal (0–1) do recorte em volta do rosto. */
  cx?: number;
}

export class Compositor {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture;
  private luts = new Map<string, WebGLTexture>();
  /** Looks (.cube) já lidos, por id do CinePRO; a LUT da correção é reconstruída quando um chega. */
  private cubes = new Map<string, CubeLut>();
  setCube(id: string, cube: CubeLut): void {
    this.cubes.set(id, cube);
    for (const [k, t] of this.luts) {
      if (k.includes(id)) {
        this.gl.deleteTexture(t);
        this.luts.delete(k);
      }
    }
  }
  hasCube(id: string): boolean {
    return this.cubes.has(id);
  }
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: false });
    if (!gl) throw new Error('WebGL2 indisponível');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(this.prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(this.prog);
    gl.useProgram(this.prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const k of ['rect', 'uvr', 'frame', 'lut', 'useLut', 'rot', 'tex', 'texel', 'res', 'seed']) this.u[k] = gl.getUniformLocation(this.prog, k);
    gl.uniform1i(this.u.frame!, 0);
    gl.uniform1i(this.u.lut!, 1);
    this.tex = this.texture(gl.TEXTURE_2D, 0);
  }

  private texture(target: number, unit: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, t);
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** LUT 3D da correção (cache por correção; muda ao vivo enquanto o slider arrasta). */
  private lutFor(g: ColorGrade): WebGLTexture {
    const key = JSON.stringify(g);
    let t = this.luts.get(key);
    if (!t) {
      const gl = this.gl;
      t = this.texture(gl.TEXTURE_3D, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, N, N, N, 0, gl.RGB, gl.FLOAT, buildLut(g, N, g.lut ? (this.cubes.get(g.lut.id) ?? null) : null));
      this.luts.set(key, t);
      if (this.luts.size > 12) {
        const [k0, t0] = this.luts.entries().next().value!;
        gl.deleteTexture(t0);
        this.luts.delete(k0);
      }
    }
    return t;
  }

  /** Ajusta a resolução interna ao tamanho mostrado (no máx. 1080 no lado menor). */
  resize(cssW: number, cssH: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const k = Math.min(1, 1080 / Math.max(1, Math.min(cssW, cssH) * dpr));
    const w = Math.max(2, Math.round(cssW * dpr * k));
    const h = Math.max(2, Math.round(cssH * dpr * k));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  draw(layers: Layer[]): void {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const l of layers) {
      const quarter = ((l.rotate ?? 0) / 90) % 4;
      const turned = quarter % 2 === 1;
      const fw = turned ? l.frame.displayHeight : l.frame.displayWidth;
      const fh = turned ? l.frame.displayWidth : l.frame.displayHeight;
      let u0 = 0;
      let v0 = 0;
      let u1 = 1;
      let v1 = 1;
      let x0 = -1;
      let y0 = -1;
      let x1 = 1;
      let y1 = 1;
      if (l.fit === 'contain') {
        const z = Math.max(1, l.zoom ?? 1);
        u0 = v0 = 0.5 - 0.5 / z;
        u1 = v1 = 0.5 + 0.5 / z;
        const s = Math.min(W / fw, H / fh);
        const sx = (fw * s) / W;
        const sy = (fh * s) / H;
        [x0, x1, y0, y1] = [-sx, sx, -sy, sy];
      } else if (l.fit === 'reframe') {
        // Reframe: cobre o quadro e recorta na horizontal em volta do rosto (cx), com o zoom por cima.
        const z = Math.max(1, l.zoom ?? 1);
        const ar = fw / fh;
        const AR = W / H;
        const kx = Math.min(1, AR / ar) / z;
        const ky = Math.min(1, ar / AR) / z;
        const cx = Math.min(1 - kx / 2, Math.max(kx / 2, l.cx ?? 0.5));
        u0 = cx - kx / 2;
        u1 = cx + kx / 2;
        v0 = 0.5 - ky / 2;
        v1 = 0.5 + ky / 2;
      } else {
        // cover: recorta o excesso do lado que sobra
        const ar = fw / fh;
        const AR = W / H;
        if (ar > AR) {
          const k = AR / ar;
          u0 = 0.5 - k / 2;
          u1 = 0.5 + k / 2;
        } else {
          const k = ar / AR;
          v0 = 0.5 - k / 2;
          v1 = 0.5 + k / 2;
        }
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, l.frame);
      const grade = l.grade && !isNeutral(l.grade) ? l.grade : null;
      if (grade) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, this.lutFor(grade));
      }
      gl.uniform1f(this.u.useLut!, grade ? 1 : 0);
      // Textura do grade (não cabe na LUT): os mesmos valores que o FFmpeg aplica no export.
      const tx = textureOf(l.grade);
      gl.uniform3f(this.u.tex!, tx.sharpen, tx.vignette, tx.grain);
      gl.uniform2f(this.u.texel!, 1 / Math.max(1, l.frame.displayWidth), 1 / Math.max(1, l.frame.displayHeight));
      gl.uniform2f(this.u.res!, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.u.seed!, (performance.now() % 1000) / 1000);
      gl.uniform4f(this.u.rect!, x0, y0, x1, y1);
      // O recorte foi calculado na imagem já girada; em 90/270 os eixos da fonte trocam.
      if (turned) gl.uniform4f(this.u.uvr!, v0, u0, v1, u1);
      else gl.uniform4f(this.u.uvr!, u0, v0, u1, v1);
      gl.uniform1f(this.u.rot!, quarter);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  clear(): void {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}
