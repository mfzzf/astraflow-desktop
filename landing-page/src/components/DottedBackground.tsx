import { useEffect, useRef, type CSSProperties } from 'react'
import {
  Renderer,
  Camera,
  Mesh,
  Plane,
  Program,
  RenderTarget,
  type OGLRenderingContext,
} from 'ogl'

const perlinVertexShader = `#version 300 es
in vec2 uv;
in vec2 position;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0., 1.);
}`

const perlinFragmentShader = `#version 300 es
precision mediump float;
uniform float uFrequency;
uniform float uTime;
uniform float uSpeed;
uniform float uValue;
uniform vec2 uResolution;
in vec2 vUv;
out vec4 fragColor;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  uv = (uv - 0.5) * vec2(aspect, 1.0) + 0.5;
  float hue = abs(snoise(vec3(uv * uFrequency, uTime * uSpeed)));
  vec3 rainbowColor = hsv2rgb(vec3(hue, 1.0, uValue));
  fragColor = vec4(rainbowColor, 1.0);
}`

const dotVertexShader = `#version 300 es
in vec2 uv;
in vec2 position;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0., 1.);
}`

const dotFragmentShader = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform sampler2D uTexture;
uniform int uPaletteCount;
uniform vec3 uPalette[10];
uniform float uPaletteA[10];
uniform float uCellSize;
uniform float uGamma;
uniform float uPaletteBias;
uniform vec2 uMouse;
uniform float uMouseRadius;
uniform float uMouseStrength;
out vec4 fragColor;

void main() {
  vec2 pix = gl_FragCoord.xy;
  float cell = max(uCellSize, 1.0);

  vec2 cellIdx = floor(pix / cell);
  vec2 cellCenter = (cellIdx + 0.5) * cell;
  vec3 col = texture(uTexture, cellCenter / uResolution.xy).rgb;
  float gray = 0.3 * col.r + 0.59 * col.g + 0.11 * col.b;
  gray = pow(clamp(gray, 0.0001, 1.0), uGamma);

  // 鼠标附近提升灰度 —— 点变大变亮，形成一团跟随光斑
  float md = distance(cellCenter, uMouse);
  float infl = 1.0 - smoothstep(0.0, max(uMouseRadius, 1.0), md);
  gray = clamp(gray + infl * uMouseStrength, 0.0, 1.0);

  vec2 cellUV = fract(pix / cell) - 0.5;
  float dist = length(cellUV);
  float radius = clamp(gray + uPaletteBias, 0.0, 1.0) * 0.5;
  float aa = fwidth(dist) + 1e-4;
  float mark = 1.0 - smoothstep(radius - aa, radius + aa, dist);

  float g2 = clamp(gray + uPaletteBias, 0.0, 1.0);
  int cnt = max(uPaletteCount, 1);
  vec3 dotCol;
  float dotOpacity;
  if (cnt <= 1) {
    dotCol = uPalette[0];
    dotOpacity = uPaletteA[0];
  } else {
    float scaled = g2 * float(cnt - 1);
    int i0 = int(floor(scaled));
    i0 = clamp(i0, 0, cnt - 2);
    float f = scaled - float(i0);
    dotCol = mix(uPalette[i0], uPalette[i0 + 1], f);
    dotOpacity = mix(uPaletteA[i0], uPaletteA[i0 + 1], f);
  }
  fragColor = vec4(dotCol, mark * dotOpacity);
}`

const MAX_COLORS = 10
const DEFAULT_COLORS = ['#EEF1FD', '#5B73E2', '#4338CA']

type Rgba = { r: number; g: number; b: number; a: number }

function parseColorToRgba(input: string): Rgba {
  if (!input) return { r: 0, g: 0, b: 0, a: 1 }
  const hex = input.trim().replace(/^#/, '')
  const at = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255
  if (hex.length === 8) return { r: at(0), g: at(2), b: at(4), a: at(6) }
  if (hex.length === 6) return { r: at(0), g: at(2), b: at(4), a: 1 }
  if (hex.length === 4) {
    const d = (i: number) => parseInt(hex[i] + hex[i], 16) / 255
    return { r: d(0), g: d(1), b: d(2), a: d(3) }
  }
  if (hex.length === 3) {
    const d = (i: number) => parseInt(hex[i] + hex[i], 16) / 255
    return { r: d(0), g: d(1), b: d(2), a: 1 }
  }
  return { r: 0, g: 0, b: 0, a: 1 }
}

function buildPaletteUniforms(colorList: string[]) {
  const rgb: [number, number, number][] = []
  const alpha: number[] = []
  for (let i = 0; i < MAX_COLORS; i++) {
    const src = colorList[i]
    if (src != null) {
      const { r, g, b, a } = parseColorToRgba(src)
      rgb.push([r, g, b])
      alpha.push(a)
    } else {
      rgb.push([0, 0, 0])
      alpha.push(0)
    }
  }
  return { rgb, alpha }
}

const mapLinear = (v: number, iMin: number, iMax: number, oMin: number, oMax: number) =>
  iMax === iMin ? oMin : oMin + ((v - iMin) / (iMax - iMin)) * (oMax - oMin)
const mapFrequency = (ui: number) => mapLinear(ui, 1, 10, 0.3, 6)
const mapSpeed = (ui: number) => ui * 0.05
const mapCellSize = (ui: number) => mapLinear(ui, 1, 100, 6, 60)
const mapGamma = (ui: number) => mapLinear(ui, 1, 20, 0.5, 8)
const mapPaletteBias = (ui: number) => ui * 0.05

interface DottedBackgroundProps {
  frequency?: number
  speed?: number
  bgColor?: string
  colors?: string[]
  cellSize?: number
  gamma?: number
  paletteBias?: number
  /** 鼠标光斑半径（CSS 像素），默认 200 */
  mouseRadius?: number
  /** 鼠标光斑对灰度的提升强度，默认 0.55 */
  mouseStrength?: number
  /** 是否响应鼠标，默认 true */
  interactive?: boolean
  style?: CSSProperties
}

/**
 * 点阵噪声背景：Perlin 噪声生成灰度场，再按调色板映射为半透明圆点阵列。
 * 基于 ogl（WebGL），30fps 节流；尊重 prefers-reduced-motion——命中时只渲染一帧静态图。
 * 改编自 Originkit Dot Matrix。
 */
export default function DottedBackground({
  frequency = 1,
  speed = 6,
  bgColor = 'transparent',
  colors,
  cellSize = 20,
  gamma = 4,
  paletteBias = 10,
  mouseRadius = 200,
  mouseStrength = 0.55,
  interactive = true,
  style,
}: DottedBackgroundProps) {
  const paletteColors =
    Array.isArray(colors) && colors.length > 0 ? colors : DEFAULT_COLORS
  const paletteCount = Math.min(MAX_COLORS, Math.max(1, paletteColors.length))
  const paletteKey = paletteColors.slice(0, MAX_COLORS).join('|')

  const containerRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const glRef = useRef<OGLRenderingContext | null>(null)
  const cameraRef = useRef<Camera | null>(null)
  const perlinProgramRef = useRef<Program | null>(null)
  const dotProgramRef = useRef<Program | null>(null)
  const perlinMeshRef = useRef<Mesh | null>(null)
  const dotMeshRef = useRef<Mesh | null>(null)
  const renderTargetRef = useRef<RenderTarget | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const container = containerRef.current
    if (!container) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const renderer = new Renderer({
      dpr,
      alpha: true,
      premultipliedAlpha: false,
    })
    const gl = renderer.gl
    container.appendChild(gl.canvas)
    rendererRef.current = renderer
    glRef.current = gl

    const camera = new Camera(gl, { near: 0.1, far: 100 })
    camera.position.set(0, 0, 3)
    cameraRef.current = camera

    const palette = buildPaletteUniforms(paletteColors)

    const perlinProgram = new Program(gl, {
      vertex: perlinVertexShader,
      fragment: perlinFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uFrequency: { value: mapFrequency(frequency) },
        uSpeed: { value: mapSpeed(speed) },
        uValue: { value: 1 },
        uResolution: { value: [gl.canvas.width, gl.canvas.height] },
      },
    })
    perlinProgramRef.current = perlinProgram
    const perlinMesh = new Mesh(gl, {
      geometry: new Plane(gl, { width: 2, height: 2 }),
      program: perlinProgram,
    })
    perlinMeshRef.current = perlinMesh

    const renderTarget = new RenderTarget(gl)
    renderTargetRef.current = renderTarget

    const dotProgram = new Program(gl, {
      vertex: dotVertexShader,
      fragment: dotFragmentShader,
      uniforms: {
        uResolution: { value: [gl.canvas.width, gl.canvas.height] },
        uTexture: { value: renderTarget.texture },
        uPaletteCount: { value: paletteCount },
        uPalette: { value: palette.rgb },
        uPaletteA: { value: palette.alpha },
        uCellSize: { value: mapCellSize(cellSize) },
        uGamma: { value: mapGamma(gamma) },
        uPaletteBias: { value: mapPaletteBias(paletteBias) },
        uMouse: { value: [-1e5, -1e5] },
        uMouseRadius: { value: mouseRadius * dpr },
        uMouseStrength: { value: interactive ? mouseStrength : 0 },
      },
    })
    dotProgramRef.current = dotProgram
    const dotMesh = new Mesh(gl, {
      geometry: new Plane(gl, { width: 2, height: 2 }),
      program: dotProgram,
    })
    dotMeshRef.current = dotMesh

    const renderFrame = (timeMs: number) => {
      perlinProgram.uniforms.uTime.value = timeMs * 0.001
      perlinProgram.uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height]
      renderer.render({ scene: perlinMesh, camera, target: renderTarget })
      dotProgram.uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height]
      renderer.render({ scene: dotMesh, camera })
    }

    const resize = () => {
      const w = container.clientWidth || window.innerWidth
      const h = container.clientHeight || window.innerHeight
      renderer.setSize(w, h)
      renderTarget.setSize(gl.canvas.width, gl.canvas.height)
      perlinProgram.uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height]
      dotProgram.uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height]
    }
    resize()

    // 鼠标跟随：全局监听指针（点阵层 pointer-events:none），换算成画布像素坐标写入 uniform
    const mouse = dotProgram.uniforms.uMouse.value as [number, number]
    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      mouse[0] = (e.clientX - rect.left) * dpr
      mouse[1] = (rect.height - (e.clientY - rect.top)) * dpr
    }
    if (interactive) window.addEventListener('pointermove', onPointerMove)

    const ro = new ResizeObserver(() => {
      resize()
      renderFrame(0)
    })
    ro.observe(container)

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const frameInterval = 1000 / 30
    let last = 0
    const loop = (t: number) => {
      if (t - last >= frameInterval) {
        last = t
        renderFrame(t)
      }
      rafRef.current = requestAnimationFrame(loop)
    }

    renderFrame(0)
    if (!reduce) rafRef.current = requestAnimationFrame(loop)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      if (interactive) window.removeEventListener('pointermove', onPointerMove)
      if (gl.canvas.parentElement === container) container.removeChild(gl.canvas)
      rendererRef.current = null
      glRef.current = null
      cameraRef.current = null
      perlinProgramRef.current = null
      dotProgramRef.current = null
      perlinMeshRef.current = null
      dotMeshRef.current = null
      renderTargetRef.current = null
      rafRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 参数变化时热更新 uniforms（不重建场景）
  useEffect(() => {
    const perlin = perlinProgramRef.current
    const dot = dotProgramRef.current
    if (!perlin || !dot) return
    const palette = buildPaletteUniforms(paletteColors)
    perlin.uniforms.uFrequency.value = mapFrequency(frequency)
    perlin.uniforms.uSpeed.value = mapSpeed(speed)
    dot.uniforms.uPaletteCount.value = paletteCount
    dot.uniforms.uPalette.value = palette.rgb
    dot.uniforms.uPaletteA.value = palette.alpha
    dot.uniforms.uCellSize.value = mapCellSize(cellSize)
    dot.uniforms.uGamma.value = mapGamma(gamma)
    dot.uniforms.uPaletteBias.value = mapPaletteBias(paletteBias)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency, speed, cellSize, gamma, paletteBias, paletteCount, paletteKey])

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: bgColor,
        lineHeight: 0,
        overflow: 'hidden',
        ...style,
      }}
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  )
}
