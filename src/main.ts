import { effect } from '@vue/reactivity'
import type { PipelineStep } from './pipeline/oaPipeline'

const BASE = import.meta.env.BASE_URL
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!

// ------------------------------------------------------------------ hero: the UDF of a non-manifold Y and an open curve, contoured

const hero = $('.hero')
const iso = $<HTMLCanvasElement>('#iso')

function heroSegments(w: number, h: number) {
  const segs: [number, number, number, number][] = []
  const cx = 0.86 * w, cy = 0.42 * h
  for (const [x, y] of [[0.97, 0.08], [1.04, 0.62], [0.74, 0.86]])
    segs.push([cx, cy, x * w, y * h])
  let px = -0.04 * w, py = 0.78 * h
  for (let i = 1; i <= 24; i++) {
    const t = i / 24
    const x = (-0.04 + t * 0.24) * w, y = (0.78 - 0.5 * t + 0.07 * Math.sin(t * 7)) * h
    segs.push([px, py, x, y])
    px = x
    py = y
  }
  return segs
}

function drawIsolines() {
  const w = hero.clientWidth, h = hero.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2)
  iso.width = w * dpr
  iso.height = h * dpr
  const g = iso.getContext('2d')!
  g.scale(dpr, dpr)
  const css = getComputedStyle(document.documentElement)
  const [warm, cool, ink, bg] = ['--acc', '--acc2', '--ink', '--bg'].map(v => css.getPropertyValue(v).trim())
  const segs = heroSegments(w, h)
  const step = 5, nx = Math.ceil(w / step) + 1, ny = Math.ceil(h / step) + 1
  const field = new Float32Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = i * step, y = j * step
      let m = Infinity
      for (const [ax, ay, bx, by] of segs) {
        const dx = bx - ax, dy = by - ay
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
        m = Math.min(m, (ax + t * dx - x) ** 2 + (ay + t * dy - y) ** 2)
      }
      field[j * nx + i] = Math.sqrt(m)
    }
  }
  // marching squares, one level at a time; the 3rd level plays the α-offset surface
  const GAP = 16, ALPHA = 3
  for (let k = 1; k <= 22; k++) {
    const L = k * GAP
    g.beginPath()
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const v = [field[j * nx + i], field[j * nx + i + 1], field[(j + 1) * nx + i + 1], field[(j + 1) * nx + i]]
        const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]
        const pts: [number, number][] = []
        for (let e = 0; e < 4; e++) {
          const a = v[e], b = v[(e + 1) % 4]
          if ((a < L) !== (b < L)) {
            const t = (L - a) / (b - a), A = c[e], B = c[(e + 1) % 4]
            pts.push([(A[0] + t * (B[0] - A[0])) * step, (A[1] + t * (B[1] - A[1])) * step])
          }
        }
        for (let p = 0; p + 1 < pts.length; p += 2) {
          g.moveTo(...pts[p])
          g.lineTo(...pts[p + 1])
        }
      }
    }
    const isAlpha = k === ALPHA
    g.strokeStyle = k <= ALPHA ? warm : cool
    g.globalAlpha = isAlpha ? 0.85 : Math.max(0.06, 0.42 - k * 0.018)
    g.lineWidth = isAlpha ? 1.8 : 1
    g.setLineDash(isAlpha || k % 2 ? [] : [3, 4])
    g.stroke()
  }
  g.setLineDash([])
  g.strokeStyle = ink
  g.globalAlpha = 0.55
  g.lineWidth = 2.2
  g.beginPath()
  for (const [ax, ay, bx, by] of segs) {
    g.moveTo(ax, ay)
    g.lineTo(bx, by)
  }
  g.stroke()
  g.globalAlpha = 1
  // fade the field toward the centre, behind the title
  const fade = g.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, Math.max(w * 0.42, h * 0.62))
  fade.addColorStop(0, bg)
  fade.addColorStop(0.75, `${bg}cc`)
  fade.addColorStop(1, `${bg}00`)
  g.fillStyle = fade
  g.fillRect(0, 0, w, h)
}

let isoWidth = 0
new ResizeObserver(() => {
  if (hero.clientWidth !== isoWidth) {
    isoWidth = hero.clientWidth
    drawIsolines()
  }
}).observe(hero)

// ------------------------------------------------------------------ method: the 3D replay of the slides

/** Each step plays the slide clicks of its scene list in turn (oaPipeline SCENES). */
const STEPS: { key: PipelineStep, clicks: number, frames?: 'sampling2d' | 'optimization2d' }[] = [
  { key: 'udf', clicks: 3 },
  { key: 'offset', clicks: 1 },
  { key: 'sampling', clicks: 2, frames: 'sampling2d' },
  { key: 'init', clicks: 2 },
  { key: 'optimization', clicks: 2, frames: 'optimization2d' },
  { key: 'connect', clicks: 2 },
]
const STILL_MS = 1400 // a scene without a timeline stays this long before the next click
const PAUSE_MS = 600 // pause at the end of a timeline before the next click

const stepButtons = [...document.querySelectorAll<HTMLButtonElement>('.step')]
const articles = [...document.querySelectorAll<HTMLElement>('.side article')]
const msg = $('#stage-msg'), iter = $('#stage-iter'), progress = $('#progress')
const playBtn = $<HTMLButtonElement>('#play'), nextBtn = $<HTMLButtonElement>('#next')

let pipeline: typeof import('./pipeline/oaPipeline') | null = null
let stage: ReturnType<typeof import('./pipeline/oaPipeline')['pipelineStage']> | null = null
let current = 0
let click = 0
let advance = 0 // timer of the next click

function selectStep(i: number) {
  current = i
  stepButtons.forEach((b, j) => {
    b.setAttribute('aria-selected', String(j === i))
    b.classList.toggle('done', j < i)
  })
  articles.forEach((a, j) => { a.hidden = j !== i })
  nextBtn.textContent = i < STEPS.length - 1 ? 'Next step →' : 'Start over ↺'
  showClick(0)
}

function showClick(c: number) {
  clearTimeout(advance)
  click = c
  if (!stage || !pipeline)
    return
  pipeline.pipelineClock.key = '' // replaying the same scene restarts it
  stage.show(STEPS[current].key, c)
  if (pipeline.pipelineClock.duration === 0 && c + 1 < STEPS[current].clicks)
    advance = window.setTimeout(() => showClick(c + 1), STILL_MS)
}

stepButtons.forEach((b, i) => b.addEventListener('click', () => selectStep(i)))
nextBtn.addEventListener('click', () => selectStep((current + 1) % STEPS.length))
$('#replay').addEventListener('click', () => showClick(0))
playBtn.addEventListener('click', () => {
  if (!pipeline)
    return
  const clock = pipeline.pipelineClock
  if (clock.duration === 0 || (clock.progress >= 1 && click + 1 >= STEPS[current].clicks))
    return showClick(0)
  clock.playing = !clock.playing
})

// 2D frames of the fast forward, in step with the timeline. They are decoded ahead and drawn on a
// canvas, cross-fading between the two frames around the timeline position: the timeline plays the
// 20 fps frames about 3× slower than the video, so single frames would step visibly.
type FrameSet = 'sampling2d' | 'optimization2d'
const FRAME_COUNT: Record<FrameSet, number> = { sampling2d: 70, optimization2d: 110 }
const frames = new Map<FrameSet, (HTMLImageElement | null)[]>()
function framePath(set: FrameSet, n: number) {
  return `${BASE}oa/pipeline/${set}/${String(n).padStart(4, '0')}.webp`
}
function preloadFrames(set: FrameSet) {
  if (frames.has(set))
    return
  const list: (HTMLImageElement | null)[] = Array.from({ length: FRAME_COUNT[set] }, () => null)
  frames.set(set, list)
  list.forEach((_, k) => {
    const img = new Image()
    img.src = framePath(set, k + 1)
    img.decode().then(() => {
      list[k] = img
      if (k === 0)
        drawFrame(set, 1)
    }).catch(() => {})
  })
}
/** Nearest decoded frame to file number n (1-based), or null. */
function decoded(set: FrameSet, n: number) {
  const list = frames.get(set)
  if (!list)
    return null
  for (let d = 0; d < list.length; d++) {
    const lo = list[n - 1 - d], hi = list[n - 1 + d]
    if (lo)
      return lo
    if (hi)
      return hi
  }
  return null
}
function drawFrame(set: FrameSet, x: number) {
  const canvas = document.querySelector<HTMLCanvasElement>(`.frames[data-frames="${set}"]`)
  const n = Math.max(1, Math.min(FRAME_COUNT[set], Math.floor(x)))
  const a = decoded(set, n)
  if (!canvas || !a)
    return
  const g = canvas.getContext('2d')!
  g.globalAlpha = 1
  g.drawImage(a, 0, 0, canvas.width, canvas.height)
  const t = x - n
  const b = n < FRAME_COUNT[set] ? frames.get(set)![n] : null
  if (t > 0.01 && b) {
    g.globalAlpha = t
    g.drawImage(b, 0, 0, canvas.width, canvas.height)
    g.globalAlpha = 1
  }
}

async function startStage() {
  pipeline = await import('./pipeline/oaPipeline')
  stage = pipeline.pipelineStage()
  stage.attach($('#stage'))
  preloadFrames('sampling2d')
  preloadFrames('optimization2d')
  const clock = pipeline.pipelineClock

  new IntersectionObserver(([e]) => { stage!.ps.active = e.isIntersecting }).observe($('#stage'))

  effect(() => {
    msg.textContent = clock.error ? `Could not load the 3D replay (${clock.error})` : 'Loading the 3D replay…'
    msg.hidden = clock.ready && !clock.error
  })
  effect(() => {
    progress.style.width = `${(clock.duration > 0 ? clock.progress : 1) * 100}%`
    const done = clock.duration === 0 || (clock.progress >= 1 && click + 1 >= STEPS[current].clicks)
    playBtn.textContent = done ? '↺' : clock.playing ? '❚❚' : '▶'
    playBtn.setAttribute('aria-label', done ? 'Replay' : clock.playing ? 'Pause' : 'Play')
  })
  // read the clock first: an effect only tracks what it reads on every run, so an early exit
  // (a step without 2D frames) must not skip the reads
  effect(() => {
    const key = clock.key, iteration = clock.iteration
    iter.hidden = !key.startsWith('optimization')
    iter.textContent = `iteration ${Math.round(iteration)}`
  })
  effect(() => {
    const x = clock.frame2dExact
    const set = STEPS[current].frames
    if (set)
      drawFrame(set, x)
  })
  // a finished timeline moves on to the next click of the step
  effect(() => {
    if (clock.duration > 0 && clock.progress >= 1 && !clock.playing && click + 1 < STEPS[current].clicks) {
      const next = click + 1
      clearTimeout(advance)
      advance = window.setTimeout(() => showClick(next), PAUSE_MS)
    }
  })
  selectStep(current)
}

// load three.js and the replay data (~13 MB) only when the Method section comes near
const lazy = new IntersectionObserver(([e]) => {
  if (e.isIntersecting) {
    lazy.disconnect()
    startStage().catch((err) => { msg.textContent = `Could not start the 3D replay (${err})` })
  }
}, { rootMargin: '600px 0px' })
lazy.observe($('#method'))
selectStep(0)

// ------------------------------------------------------------------ results: swipe comparison

interface Method { id: string, name: string, stat?: string }
/** `res`: grid resolution the baselines extracted their meshes at (ours is grid-free) */
interface Dataset { id: string, name: string, res: string, ours: string, methods: Method[], note: string }
// per-model numbers from the paper figures (Fig. 13-15; CD ×10⁻³); ABC and non-manifold: averages of Tables 2-3
const DATASETS: Dataset[] = [
  {
    id: 'copyroom', name: '3DScene', res: '256³', ours: '#V 46.6K · CD 2.21',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'Copyroom' },
      { id: 'capudf', name: 'CAP-UDF', stat: '#V 241.2K · CD 1.96' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: '#V 247.9K · CD 1.88' },
      { id: 'meshudf', name: 'MeshUDF', stat: '#V 199.9K · CD 3.77' },
      { id: 'geoudf', name: 'GeoUDF', stat: '#V 167.6K · CD 1.84' },
      { id: 'mind', name: 'MIND', stat: '#V 119.8K · CD 3.16' },
      { id: 'dcudf', name: 'DCUDF', stat: '#V 286.9K · CD 2.74' },
      { id: 'dcudf2', name: 'DCUDF2', stat: '#V 447.9K · CD 2.22' },
    ],
    note: 'A scanned room, baselines at 256³: a similar Chamfer distance (×10⁻³) with <b>3 to 10× fewer vertices</b>.',
  },
  {
    id: 'car', name: 'ShapeNetCar', res: '256³', ours: '#V 17.4K · CD 1.52',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'ShapeNetCar' },
      { id: 'capudf', name: 'CAP-UDF', stat: '#V 201.3K · CD 2.11' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: '#V 228.1K · CD 2.21' },
      { id: 'meshudf', name: 'MeshUDF', stat: '#V 164.7K · CD 2.33' },
      { id: 'geoudf', name: 'GeoUDF', stat: '#V 140.5K · CD 1.95' },
      { id: 'mind', name: 'MIND', stat: '#V 101.3K · CD 1.68' },
      { id: 'dcudf', name: 'DCUDF', stat: '#V 302.3K · CD 1.91' },
      { id: 'dcudf2', name: 'DCUDF2', stat: '#V 434.3K · CD 1.90' },
    ],
    note: 'A car with its interior, baselines at 256³: <b>the best Chamfer distance</b> with 6 to 25× fewer vertices.',
  },
  {
    id: 'garment', name: 'DeepFashion', res: '128³', ours: '#V 15.2K · CD 2.13',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'DeepFashion 18-9' },
      { id: 'capudf', name: 'CAP-UDF', stat: '#V 49.9K · CD 2.87' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: '#V 56.2K · CD 1.80' },
      { id: 'meshudf', name: 'MeshUDF', stat: '#V 45.4K · CD 4.08' },
      { id: 'geoudf', name: 'GeoUDF', stat: '#V 33.5K · CD 2.75' },
      { id: 'mind', name: 'MIND', stat: '#V 26.5K · CD 3.16' },
      { id: 'dcudf', name: 'DCUDF', stat: '#V 79.7K · CD 2.79' },
      { id: 'dcudf2', name: 'DCUDF2', stat: '#V 92.7K · CD 2.55' },
    ],
    note: 'An open garment, baselines at 128³: comparable accuracy with the most compact mesh.',
  },
  {
    id: 'sharp020', name: 'Sharp features', res: '128³', ours: 'edge-CD 12.89 · 22.6K',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'ABC' },
      { id: 'capudf', name: 'CAP-UDF', stat: 'edge-CD 19.42 · 46.0K' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: 'edge-CD 28.33 · 47.8K' },
      { id: 'meshudf', name: 'MeshUDF', stat: 'edge-CD 20.21 · 45.3K' },
      { id: 'geoudf', name: 'GeoUDF', stat: 'edge-CD 35.45 · 36.4K' },
      { id: 'mind', name: 'MIND', stat: 'edge-CD 99.53 · 27.8K' },
      { id: 'dcudf', name: 'DCUDF', stat: 'edge-CD 74.08 · 43.5K' },
      { id: 'dcudf2', name: 'DCUDF2', stat: 'edge-CD 40.99 · 49.0K' },
    ],
    note: 'Averages over 100 ABC models (sharp edges at a 45° dihedral angle; baselines at 128³): <b>the best sharp-edge Chamfer distance</b> with the most compact mesh.',
  },
  {
    id: 'nm007', name: 'Non-manifold', res: '128³', ours: 'triangle soup · NM edge-CD 18.13 · 31.5K',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'intersected ABC' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: 'NM edge-CD 65.64 · 80.2K' },
      { id: 'mind', name: 'MIND', stat: 'NM edge-CD 44.18 · 51.5K' },
    ],
    note: 'Averages over 50 intersected ABC models, baselines at 128³. Ours queries the distance to the triangle soup directly; non-manifold junctions come out as a single sheet.',
  },
]

const swipe = $('#swipe')
const baseImg = $<HTMLImageElement>('#swipe-base'), oursImg = $<HTMLImageElement>('#swipe-ours')
const gtImg = $<HTMLImageElement>('#gt-img'), tagGt = $('#tag-gt')
const tagBase = $('#tag-base'), tagOurs = $('#tag-ours'), thumbs = $('#thumbs'), datasetsEl = $('#datasets')
const resultPath = (d: string, m: string) => `${BASE}img/results/aligned/${d}_${m}.webp`

const resolution = (d: Dataset, m: Method) => (m.id === 'gt' ? '' : `${d.res} grid`)
const statLine = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ')

function pickMethod(d: Dataset, m: Method) {
  baseImg.src = resultPath(d.id, m.id)
  baseImg.alt = `${m.name} reconstruction`
  tagBase.innerHTML = `${m.name}<small>${resolution(d, m)}</small>` // the numbers are under the thumbnails
  thumbs.querySelectorAll<HTMLButtonElement>('button[data-m]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === m.id)))
}

function pickDataset(d: Dataset) {
  datasetsEl.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.d === d.id)))
  const gt = d.methods.find(m => m.id === 'gt')!
  gtImg.src = resultPath(d.id, 'gt')
  tagGt.innerHTML = `${gt.name}<small>${statLine(gt.stat)}</small>`
  const picks = d.methods.filter(m => m.id !== 'gt')
  oursImg.src = resultPath(d.id, 'ours')
  oursImg.alt = 'OffsetAxis reconstruction'
  tagOurs.innerHTML = `Ours<small>grid-free</small>`
  thumbs.replaceChildren()
  const ours = Object.assign(document.createElement('button'), { type: 'button', className: 'is-ours', disabled: true })
  ours.innerHTML = `<img src="${resultPath(d.id, 'ours')}" alt="">Ours<small>${statLine('grid-free', d.ours)}</small>`
  thumbs.append(ours)
  for (const m of picks) {
    const b = Object.assign(document.createElement('button'), { type: 'button' })
    b.dataset.m = m.id
    b.innerHTML = `<img src="${resultPath(d.id, m.id)}" alt="">${m.name}<small>${statLine(resolution(d, m), m.stat)}</small>`
    b.addEventListener('click', () => pickMethod(d, m))
    thumbs.append(b)
  }
  $('#dataset-note').innerHTML = d.note
  pickMethod(d, picks[0])
}

for (const d of DATASETS) {
  const b = Object.assign(document.createElement('button'), { type: 'button', textContent: d.name })
  b.setAttribute('role', 'tab')
  b.dataset.d = d.id
  b.addEventListener('click', () => pickDataset(d))
  datasetsEl.append(b)
}
pickDataset(DATASETS[0])

function setDivider(pct: number) {
  const x = Math.max(0, Math.min(100, pct))
  swipe.style.setProperty('--x', `${x}%`)
  swipe.setAttribute('aria-valuenow', String(Math.round(x)))
}
let dragging = false
const fromEvent = (e: PointerEvent) => {
  const r = swipe.getBoundingClientRect()
  setDivider((e.clientX - r.left) / r.width * 100)
}
swipe.addEventListener('pointerdown', (e) => {
  dragging = true
  swipe.setPointerCapture(e.pointerId)
  fromEvent(e)
})
swipe.addEventListener('pointermove', e => dragging && fromEvent(e))
swipe.addEventListener('pointerup', () => { dragging = false })
swipe.addEventListener('pointercancel', () => { dragging = false })
swipe.addEventListener('keydown', (e) => {
  const now = Number(swipe.getAttribute('aria-valuenow'))
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault()
    setDivider(now + (e.key === 'ArrowLeft' ? -5 : 5))
  }
})

// ------------------------------------------------------------------ BibTeX

const copyBtn = $<HTMLButtonElement>('#copy')
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#bibtex').textContent ?? '')
    copyBtn.textContent = 'Copied'
  }
  catch {
    copyBtn.textContent = 'Select and copy'
  }
  setTimeout(() => { copyBtn.textContent = 'Copy' }, 1600)
})
