// 2D fast forward frames of the Pipeline slides (OaPipeline `frames` prop). Every frame of a set is
// fetched and decoded once, into a module-level cache shared by all slides and instances, so the
// playback only draws decoded bitmaps and never asks the browser for an image again.
import { shallowReactive } from '@vue/reactivity'
import { loadPipeline, PIPELINE_URL } from './oaPipeline'

export type FrameSet = 'sampling2d' | 'optimization2d'

const bitmaps: Record<FrameSet, Map<number, ImageBitmap>> = { sampling2d: new Map(), optimization2d: new Map() }
const loading: Partial<Record<FrameSet, Promise<void>>> = {}

/** Bumped each time a frame of the set is decoded, so the views can redraw. */
export const frameVersion = shallowReactive<Record<FrameSet, number>>({ sampling2d: 0, optimization2d: 0 })

/** Decoded frame `n` (file numbers start at 1), if it is loaded already. */
export function decodedFrame(set: FrameSet, n: number): ImageBitmap | undefined {
  return bitmaps[set].get(n)
}

/** Fetches and decodes all frames of the set (count from the manifest); resolves once, cached. */
export function preloadFrames(set: FrameSet): Promise<void> {
  loading[set] ??= (async () => {
    const count = (await loadPipeline()).manifest.frames[set]
    await Promise.all(Array.from({ length: count }, async (_, i) => {
      const n = i + 1
      const res = await fetch(`${PIPELINE_URL}${set}/${String(n).padStart(4, '0')}.webp`)
      if (!res.ok)
        throw new Error(`${set}/${n}: HTTP ${res.status}`)
      bitmaps[set].set(n, await createImageBitmap(await res.blob()))
      frameVersion[set]++
    }))
  })()
  return loading[set]!
}

export interface SamplingEvent { entry: [number, number], exit: [number, number], times: number[] }

/**
 * The rays stage of the sampling 2D animation, drawn at the continuous frame `f` (frames from 0) on
 * top of the clean background frame 1. Same drawing as fast_forward/scripts/generate_2d_sampling.py,
 * with the contact dots in full size (f is before the end of the rays, so nothing fades yet).
 */
export function drawSampling2d(ctx: CanvasRenderingContext2D, base: ImageBitmap, events: SamplingEvent[], f: number) {
  const { width: w } = base
  ctx.drawImage(base, 0, 0, w, w)
  // PIL pixel centres sit on integers, canvas pixel centres on +0.5
  ctx.save()
  ctx.translate(0.5, 0.5)
  for (const { entry, exit, times: keys } of events) {
    const [ex, ey] = entry
    const [lx, ly] = exit
    const len = Math.hypot(lx - ex, ly - ey)
    const dx = (lx - ex) / len
    const dy = (ly - ey) / len

    for (const [[x, y], when] of [[entry, keys[1]], [exit, keys[3]]] as const) {
      if (f >= when) {
        ctx.fillStyle = 'rgb(255,35,15)'
        ctx.beginPath()
        ctx.arc(x, y, 6, 0, 2 * Math.PI)
        ctx.fill()
      }
    }

    if (keys[0] <= f && f < keys[5]) {
      const reach = w * 0.35
      const positions = [[ex - dx * reach, ey - dy * reach], [ex, ey], [ex, ey], [lx, ly], [lx, ly], [lx + dx * reach, ly + dy * reach]]
      // j = searchsorted(keys, f, 'right') - 1, clamped to the segments
      let j = 0
      while (j < keys.length && keys[j] <= f)
        j++
      j = Math.min(4, Math.max(0, j - 1))
      const t = (f - keys[j]) / Math.max(1e-8, keys[j + 1] - keys[j])
      const tipX = positions[j][0] * (1 - t) + positions[j + 1][0] * t
      const tipY = positions[j][1] * (1 - t) + positions[j + 1][1] * t
      const tailX = tipX - dx * 45
      const tailY = tipY - dy * 45
      const nx = -dy
      const ny = dx

      ctx.strokeStyle = 'rgb(20,65,90)'
      ctx.fillStyle = 'rgb(20,65,90)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(tailX, tailY)
      ctx.lineTo(tipX, tipY)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(tipX, tipY)
      ctx.lineTo(tipX - dx * 9 + nx * 4, tipY - dy * 9 + ny * 4)
      ctx.lineTo(tipX - dx * 9 - nx * 4, tipY - dy * 9 - ny * 4)
      ctx.closePath()
      ctx.fill()
    }
  }
  ctx.restore()
}
