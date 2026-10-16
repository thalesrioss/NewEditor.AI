import { useEffect, useMemo, useRef } from 'react';
import { buildLut, type ColorGrade } from '@neweditor/core';
import { useCube } from '../lib/looks.ts';

const N = 33;

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = vec2((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 color;
uniform sampler2D frame; uniform sampler3D lut;
void main() {
  vec3 c = clamp(texture(frame, uv).rgb, 0.0, 1.0);
  // Amostra no centro das células do LUT (mesma interpolação do lut3d do FFmpeg).
  vec3 coord = c * ${((N - 1) / N).toFixed(6)} + ${(0.5 / N).toFixed(6)};
  color = vec4(texture(lut, coord).rgb, 1.0);
}`;

/**
 * Preview da correção de cor na GPU: o vídeo ativo passa pelo MESMO LUT 3D que o FFmpeg usa no export.
 */
export function GradeCanvas({ getVideo, grade, style }: { getVideo: () => HTMLVideoElement | null; grade: ColorGrade; style?: React.CSSProperties }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const gl = useRef<{ ctx: WebGL2RenderingContext; lutTex: WebGLTexture; frameTex: WebGLTexture } | null>(null);
  const cube = useCube(grade.lut?.id);
  const lut = useMemo(() => buildLut(grade, N, cube), [grade, cube]);

  // Contexto + shader (uma vez).
  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!ctx) return;
    const sh = (type: number, src: string) => {
      const s = ctx.createShader(type)!;
      ctx.shaderSource(s, src);
      ctx.compileShader(s);
      return s;
    };
    const prog = ctx.createProgram()!;
    ctx.attachShader(prog, sh(ctx.VERTEX_SHADER, VERT));
    ctx.attachShader(prog, sh(ctx.FRAGMENT_SHADER, FRAG));
    ctx.linkProgram(prog);
    ctx.useProgram(prog);
    const buf = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), ctx.STATIC_DRAW);
    const loc = ctx.getAttribLocation(prog, 'p');
    ctx.enableVertexAttribArray(loc);
    ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0);
    const tex = (unit: number, target: number) => {
      const t = ctx.createTexture()!;
      ctx.activeTexture(ctx.TEXTURE0 + unit);
      ctx.bindTexture(target, t);
      ctx.texParameteri(target, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
      ctx.texParameteri(target, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
      ctx.texParameteri(target, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
      ctx.texParameteri(target, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
      if (target === ctx.TEXTURE_3D) ctx.texParameteri(target, ctx.TEXTURE_WRAP_R, ctx.CLAMP_TO_EDGE);
      return t;
    };
    const frameTex = tex(0, ctx.TEXTURE_2D);
    const lutTex = tex(1, ctx.TEXTURE_3D);
    ctx.uniform1i(ctx.getUniformLocation(prog, 'frame'), 0);
    ctx.uniform1i(ctx.getUniformLocation(prog, 'lut'), 1);
    gl.current = { ctx, lutTex, frameTex };
  }, []);

  // LUT novo a cada mudança de correção.
  useEffect(() => {
    const g = gl.current;
    if (!g) return;
    g.ctx.activeTexture(g.ctx.TEXTURE1);
    g.ctx.bindTexture(g.ctx.TEXTURE_3D, g.lutTex);
    g.ctx.texImage3D(g.ctx.TEXTURE_3D, 0, g.ctx.RGB16F, N, N, N, 0, g.ctx.RGB, g.ctx.FLOAT, lut);
  }, [lut]);

  // Desenha o quadro atual sempre (acompanha play, seek e troca de clipe).
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const g = gl.current;
      const v = getVideo();
      const cv = canvas.current;
      if (g && v && cv && v.readyState >= 2 && v.videoWidth) {
        if (cv.width !== v.videoWidth || cv.height !== v.videoHeight) {
          cv.width = v.videoWidth;
          cv.height = v.videoHeight;
          g.ctx.viewport(0, 0, cv.width, cv.height);
        }
        g.ctx.activeTexture(g.ctx.TEXTURE0);
        g.ctx.bindTexture(g.ctx.TEXTURE_2D, g.frameTex);
        g.ctx.texImage2D(g.ctx.TEXTURE_2D, 0, g.ctx.RGB, g.ctx.RGB, g.ctx.UNSIGNED_BYTE, v);
        g.ctx.drawArrays(g.ctx.TRIANGLE_STRIP, 0, 4);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getVideo]);

  return <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full object-contain" style={style} />;
}
