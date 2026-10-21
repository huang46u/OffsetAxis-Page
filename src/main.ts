import { effect } from '@vue/reactivity'
import type { PipelineStep } from './pipeline/oaPipeline'
import type { SamplingEvent } from './pipeline/oaFrames'
import { GROUPS, type Dataset, type Group, type Method } from './results'

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

/** Each step plays the slide clicks of its scene list in turn (oaPipeline SCENES); hold overrides STILL_MS. */
const STEPS: { key: PipelineStep, clicks: number, hold?: number, frames?: 'sampling2d' | 'optimization2d' }[] = [
  { key: 'udf', clicks: 3 },
  { key: 'offset', clicks: 3, hold: 1500 },
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
  const step = STEPS[current]
  // the clicks also reveal the article's .k1 / .k2 parts, as on the slide
  for (let k = 1; k < step.clicks; k++)
    articles[current].classList.toggle(`at${k}`, k <= c)
  if (stage && pipeline) {
    pipeline.pipelineClock.key = '' // replaying the same scene restarts it
    stage.show(step.key, c)
    if (pipeline.pipelineClock.duration > 0)
      return
  }
  if (c + 1 < step.clicks)
    advance = window.setTimeout(() => showClick(c + 1), step.hold ?? STILL_MS)
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

// 2D frames of the fast forward, in step with the timeline. oaFrames.ts decodes them ahead when the
// stage starts, and the canvas is drawn at the timeline position. The sampling rays are drawn live
// (the 20 fps frames would step); the diffusion and optimization frames cross-fade between neighbours.
type FrameSet = 'sampling2d' | 'optimization2d'
const FRAME_COUNT: Record<FrameSet, number> = { sampling2d: 70, optimization2d: 110 }
let frameLib: typeof import('./pipeline/oaFrames') | undefined
let samplingData: { events: SamplingEvent[], rayEnd: number, frameCount: number } | undefined

/** Draws decoded frame file n (1-based) of the set, with frame n + 1 faded in by alpha on top. */
function crossFade(set: FrameSet, n: number, alpha: number) {
  const canvas = document.querySelector<HTMLCanvasElement>(`.frames[data-frames="${set}"]`)
  if (!canvas || !frameLib)
    return
  const a = frameLib.decodedFrame(set, n)
  if (!a)
    return
  const g = canvas.getContext('2d')!
  g.globalAlpha = 1
  g.drawImage(a, 0, 0, canvas.width, canvas.height)
  const b = alpha > 0.01 && n < FRAME_COUNT[set] ? frameLib.decodedFrame(set, n + 1) : undefined
  if (b) {
    g.globalAlpha = alpha
    g.drawImage(b, 0, 0, canvas.width, canvas.height)
    g.globalAlpha = 1
  }
}

/** Sampling 2D at the continuous position t (frames from 0): rays live, then the diffusion frames. */
function drawSampling(t: number) {
  const canvas = document.querySelector<HTMLCanvasElement>('.frames[data-frames="sampling2d"]')
  if (!canvas || !frameLib || !samplingData)
    return
  const { events, rayEnd, frameCount } = samplingData
  if (t > 0 && t <= rayEnd) {
    // rays: the clean background (frame 1) with the rays drawn at the continuous position
    const base = frameLib.decodedFrame('sampling2d', 1)
    if (base)
      frameLib.drawSampling2d(canvas.getContext('2d')!, base, events, t)
    return
  }
  if (t > rayEnd) {
    // diffusion: the frames are sparse, so cross-fade the two around the position
    const i = Math.floor(t)
    crossFade('sampling2d', Math.min(frameCount, Math.max(1, i + 1)), t - i)
    return
  }
  crossFade('sampling2d', 1, 0)
}

/** Optimization 2D at the frame position x (file numbers from 1). */
function drawOptimization(x: number) {
  const n = Math.max(1, Math.min(FRAME_COUNT.optimization2d, Math.floor(x)))
  crossFade('optimization2d', n, x - n)
}

async function startStage() {
  pipeline = await import('./pipeline/oaPipeline')
  frameLib = await import('./pipeline/oaFrames')
  samplingData = (await pipeline.loadPipeline()).manifest.sampling2d
  stage = pipeline.pipelineStage()
  stage.attach($('#stage'))
  frameLib.preloadFrames('sampling2d').catch(err => console.warn(err))
  frameLib.preloadFrames('optimization2d').catch(err => console.warn(err))
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
  // read the clock first (see above): the frames are drawn at the timeline position, and again
  // when a frame gets decoded (frameVersion is read so that the effect tracks it)
  effect(() => {
    const x = clock.frame2dExact, t = clock.time2d
    const versions = [frameLib?.frameVersion.sampling2d, frameLib?.frameVersion.optimization2d]
    const set = STEPS[current].frames
    if (!set || !frameLib || !versions)
      return
    if (set === 'sampling2d')
      drawSampling(t)
    else
      drawOptimization(x)
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

const swipe = $('#swipe')
const baseImg = $<HTMLImageElement>('#swipe-base'), oursImg = $<HTMLImageElement>('#swipe-ours')
const gtImg = $<HTMLImageElement>('#gt-img'), tagGt = $('#tag-gt')
const tagBase = $('#tag-base'), tagOurs = $('#tag-ours'), thumbs = $('#thumbs')
const groupsEl = $('#groups'), modelsEl = $('#models'), viewEl = $('#view-toggle')
const resultPath = (d: string, m: string) => `${BASE}img/results/aligned/${d}_${m}.webp`

let shownSet = GROUPS[0].subgroups[0].sets[0]
let baseId = '' // the baseline left of the divider, kept when switching Mesh / Patches
let patchView = false // Q-MDF: colour the manifold patches instead of the plain mesh

// GT stays the input mesh; the other renders switch to their patch variant
const imgOf = (d: Dataset, m: string) => resultPath(d.id, patchView && d.patches && m !== 'gt' ? `${m}_patch` : m)
// ours and its variants are grid-free; GT has no grid
const resolution = (d: Dataset, m: Method) => (m.id === 'gt' || m.id.startsWith('ours') ? '' : `${d.res} grid`)
const statLine = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ')

function pickMethod(m: Method) {
  baseId = m.id
  baseImg.src = imgOf(shownSet, m.id)
  baseImg.alt = `${m.name} reconstruction`
  tagBase.innerHTML = `${m.name}<small>${resolution(shownSet, m)}</small>` // the numbers are under the thumbnails
  thumbs.querySelectorAll<HTMLButtonElement>('button[data-m]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === m.id)))
}

// draws the shownSet set: GT, ours, the thumbnails of every baseline and the note
function renderSet() {
  const d = shownSet
  const gt = d.methods.find(m => m.id === 'gt')!
  gtImg.src = resultPath(d.id, 'gt')
  tagGt.innerHTML = `${gt.name}<small>${statLine(gt.stat)}</small>`
  oursImg.src = imgOf(d, 'ours')
  oursImg.alt = 'OffsetAxis reconstruction'
  tagOurs.innerHTML = 'Ours<small>grid-free</small>'
  thumbs.replaceChildren()
  const ours = Object.assign(document.createElement('button'), { type: 'button', className: 'is-ours', disabled: true })
  ours.innerHTML = `<img src="${imgOf(d, 'ours')}" alt="">Ours<small>${statLine('grid-free', d.ours)}</small>`
  thumbs.append(ours)
  const picks = d.methods.filter(m => m.id !== 'gt')
  for (const m of picks) {
    const b = Object.assign(document.createElement('button'), { type: 'button' })
    b.dataset.m = m.id
    b.innerHTML = `<img src="${imgOf(d, m.id)}" alt="">${m.name}<small>${statLine(resolution(d, m), m.stat)}</small>`
    b.addEventListener('click', () => pickMethod(m))
    thumbs.append(b)
  }
  $('#dataset-note').innerHTML = d.note
  pickMethod(picks.find(m => m.id === baseId) ?? picks[0])
}

function selectSet(d: Dataset) {
  shownSet = d
  baseId = d.methods.find(m => m.id !== 'gt')!.id
  modelsEl.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.d === d.id)))
  viewEl.hidden = !d.patches
  renderSet()
}

function selectGroup(g: Group) {
  groupsEl.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.g === g.id)))
  modelsEl.replaceChildren()
  for (const sub of g.subgroups) {
    const cluster = document.createElement('div')
    cluster.className = 'cluster'
    if (sub.name) {
      const label = document.createElement('span')
      label.className = 'cluster-label'
      label.textContent = sub.name
      cluster.append(label)
    }
    for (const d of sub.sets) {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: d.name })
      b.dataset.d = d.id
      b.addEventListener('click', () => selectSet(d))
      cluster.append(b)
    }
    modelsEl.append(cluster)
  }
  selectSet(g.subgroups[0].sets[0])
}

for (const g of GROUPS) {
  const b = Object.assign(document.createElement('button'), { type: 'button', textContent: g.name })
  b.setAttribute('role', 'tab')
  b.dataset.g = g.id
  b.addEventListener('click', () => selectGroup(g))
  groupsEl.append(b)
}

viewEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
  b.addEventListener('click', () => {
    patchView = b.dataset.view === 'patches'
    viewEl.querySelectorAll<HTMLButtonElement>('button').forEach(v => v.setAttribute('aria-pressed', String(v === b)))
    renderSet()
  })
})
selectGroup(GROUPS[0])

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
