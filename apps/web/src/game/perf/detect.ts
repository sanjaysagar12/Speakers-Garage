import { QUALITY_ORDER, type Quality } from '../config';
import { KEYS } from '../../storage';

/**
 * Startup tier detection: hardware hints (cores, memory, GPU string, mobile) + a ~1 s benchmark that
 * renders a shader roughly as expensive per pixel as the beach ground, on an offscreen canvas.
 * The result is cached per device (localStorage) so the benchmark runs once.
 */
export interface DetectResult {
  tier: Quality;
  gpu: string;
  cores: number;
  memoryGB: number | null;
  mobile: boolean;
  software: boolean;
  /** ms per benchmark frame (lower is faster), or null if WebGL2 was unavailable */
  gpuMs: number | null;
  cpuMs: number;
  reason: string;
}

const KEY = KEYS.detect;

const BENCH_FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform float t;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
void main(){
  vec2 p = gl_FragCoord.xy * 0.02 + t;
  float a = 0.;
  for (int k = 0; k < 12; k++) { a += n(p * float(k + 1)) / float(k + 1); }
  o = vec4(vec3(a * 0.3), 1.);
}`;

function gpuInfo(): { gpu: string; gl2: WebGL2RenderingContext | null; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const gl2 = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' }) as WebGL2RenderingContext | null;
  let gpu = 'unknown';
  if (gl2) {
    const ext = gl2.getExtension('WEBGL_debug_renderer_info');
    gpu = String(ext ? gl2.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl2.getParameter(gl2.RENDERER));
  }
  return { gpu, gl2, canvas };
}

/** ms per frame of a full-screen noise shader at 512x512 (synchronised with readPixels). */
function gpuBench(gl: WebGL2RenderingContext, budgetMs = 700): number | null {
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, '#version 300 es\nin vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }');
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, BENCH_FRAG);
  gl.compileShader(fs);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tl = gl.getUniformLocation(prog, 't');
  const px = new Uint8Array(4);
  // warm-up frame (shader compile), then measure
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const start = performance.now();
  let frames = 0;
  while (performance.now() - start < budgetMs && frames < 60) {
    gl.uniform1f(tl, frames * 0.1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    frames++;
  }
  const ms = (performance.now() - start) / Math.max(1, frames);
  gl.deleteBuffer(buf);
  gl.deleteProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return ms;
}

/** ms for a fixed chunk of typed-array math (roughly what the world builder does on load). */
function cpuBench(): number {
  const start = performance.now();
  const a = new Float32Array(200000);
  let acc = 0;
  for (let r = 0; r < 6; r++) {
    for (let i = 0; i < a.length; i++) {
      a[i] = Math.sin(i * 0.001 + r) * Math.sqrt(i + 1);
      acc += a[i];
    }
  }
  if (acc === 42) console.log(acc);
  return performance.now() - start;
}

export function cachedDetection(): DetectResult | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DetectResult) : null;
  } catch {
    return null;
  }
}

export function clearDetection(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Pick a starting tier. Runs the benchmark (~1 s) unless a cached result exists. */
export async function detectTier(): Promise<DetectResult> {
  const cached = cachedDetection();
  if (cached) return cached;
  // let the loading screen paint first
  await new Promise((r) => setTimeout(r, 30));
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 4;
  const memoryGB = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (window.matchMedia?.('(pointer: coarse)').matches ?? false);
  const { gpu, gl2 } = gpuInfo();
  const software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu);
  const gpuMs = gl2 ? gpuBench(gl2) : null;
  const cpuMs = cpuBench();

  // benchmark score -> tier (thresholds from the 512x512 noise shader above)
  let idx: number;
  if (gpuMs === null || software) idx = 0;
  else if (gpuMs > 40) idx = 0;
  else if (gpuMs > 16) idx = 1;
  else if (gpuMs > 6) idx = 2;
  else idx = 3;
  const reasons = [`gpu ${gpuMs === null ? 'n/a' : gpuMs.toFixed(1) + ' ms'}`, `cpu ${cpuMs.toFixed(0)} ms`];
  // hardware hints cap the benchmark
  if (memoryGB !== null && memoryGB <= 2) {
    idx = Math.min(idx, 0);
    reasons.push(`${memoryGB} GB memory`);
  } else if (memoryGB !== null && memoryGB <= 4) {
    idx = Math.min(idx, 1);
    reasons.push(`${memoryGB} GB memory`);
  }
  if (cores <= 2) {
    idx = Math.min(idx, 0);
    reasons.push(`${cores} cores`);
  } else if (cores <= 4) {
    idx = Math.min(idx, mobile ? 1 : 2);
    reasons.push(`${cores} cores`);
  }
  if (mobile) {
    idx = Math.min(idx, 2);
    reasons.push('mobile');
  }
  if (cpuMs > 120) {
    idx = Math.min(idx, 1);
    reasons.push('slow CPU');
  }
  if (software) reasons.push('software renderer');
  const res: DetectResult = { tier: QUALITY_ORDER[idx], gpu, cores, memoryGB, mobile, software, gpuMs, cpuMs, reason: reasons.join(', ') };
  try {
    localStorage.setItem(KEY, JSON.stringify(res));
  } catch {
    /* ignore */
  }
  return res;
}
