// OffsetAxis Pipeline replay: one three.js scene for the six steps of the Method section (src/main.ts
// switches the step), so the camera and the objects carry over from one step to the next, like the
// fast forward video. Ported from the defense / talk slides (presentation/slides/utils/oaPipeline.ts).
//
// Data: public/oa/pipeline/, made by presentation/slides/tools/oa_pipeline_data.py from the real fast forward outputs
// (bunny, alpha 0.005). Camera and object: the paper Pipeline figure (fast forward
// slice_metadata.json). Lights and materials: the fast forward scenes (fast_forward/blender/
// stage_03_input.blend, stage_04_optimization.blend, read with Blender in background mode).
// The look was tuned in the slides' dev panel and saved to src/looks/oa-pipeline.json.

import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { reactive } from '@vue/reactivity'
import { BLENDER_BASE, type BlenderLook, blenderToThree, type LookOverrides, mergeLook, savedLook, type Vec3 } from './blenderLook'
import { applyLook, blenderEuler, blenderSunDirection, createPaperScene, type PaperScene } from './paperScene'
import { createPaperShellDepthMaterial, createPaperShellMaterial } from './paperMaterials'

export const OA_LOOK_ID = 'oa-pipeline'

// object placement of the paper figure: the slice plane is placed relative to it
const FIGURE_OBJECT = { location: [-0.13, -0.25, -0.03] as Vec3, rotation: [95, 0, 112] as Vec3, scale: 0.45 }

// fast forward lights: three disk area lights aimed at the origin (studio_key, _fill, _rim); here
// directional lights of the irradiance they give at the origin, P / (π d²); the key light casts the
// shadow, its disk (4 m wide, 7.07 m away) gives the sun angle
const irradiance = (watts: number, location: Vec3) => watts / (Math.PI * (location[0] ** 2 + location[1] ** 2 + location[2] ** 2))

export const OA_PRESET: BlenderLook = mergeLook(BLENDER_BASE, {
  source: 'paper Pipeline figure (camera, object) + fast forward stage_03/04 .blend (lights, materials)',
  object: FIGURE_OBJECT,
  // camera rotation (72.933, 1.0082, 63.761) -> look-at on the view ray, near the bunny
  camera: { location: [0.92946, -0.50082, 0.46088], lookAt: [-0.01906, -0.03964, 0.13713], focalLength: 45 },
  sun: { rotation: [45, 0, -36.87], strength: irradiance(100, [-3, -4, 5]), angle: 31.6, castShadow: true },
  world: { color: [1, 1, 1], strength: 0.25 },
  film: { viewTransform: 'AgX', exposure: 1 },
  // stage3_input_surface (reference_surface_material_controlled): diffuse + Layer Weight ramp
  paper: { color: [0.9076, 0.789, 0.8337], blend: 0.8, rampPos: [0, 0.364, 0.86, 1], rampVal: [0.0131, 0.1337, 0.2771, 1] },
})

export type PipelineStep = 'udf' | 'offset' | 'sampling' | 'init' | 'optimization' | 'connect'
export const PIPELINE_STEPS: PipelineStep[] = ['udf', 'offset', 'sampling', 'init', 'optimization', 'connect']

/** Object (Blender frame, like a BlenderLook) and camera of one step; the slides move between them. */
export interface StepView {
  object: { location: Vec3, rotation: Vec3, scale: number }
  camera: { location: Vec3, lookAt: Vec3, focalLength: number }
  zoom: number // camera zoom (1: the focal length as is)
  // zoomed inset of the steps that show one: centre and side of the region (bunny units); its
  // camera is the camera of the step, fixed to the bunny (it does not follow the mouse)
  inset?: { focus: Vec3, size: number }
}

/** OffsetAxis settings that a BlenderLook has no place for (saved as `oa` in looks/oa-pipeline.json). */
export interface OaSettings {
  views: Record<PipelineStep, StepView>
  // α drawn (bunny units, illustrative: the α of the run, 0.005, is too thin to see): the α line
  // of the slice and the ray contacts (where the UDF = α along the rays)
  alpha: number
  fill: { rotation: Vec3, strength: number } // studio_fill
  rim: { rotation: Vec3, strength: number } // studio_rim
  ground: boolean // shadow on the ground (the fast forward has none: render.json ground.enabled false)
  // material node chains: Hue/Saturation/Value (saturation) -> Bright/Contrast -> (AO mix) -> Principled
  slice: { saturation: number, bright: number, contrast: number, roughness: number } // Figure_UDF_slice_material
  spheres: { saturation: number, bright: number, contrast: number, ao: number, roughness: number, radiusScale: number } // medial_balls_material_controlled
  mesh: { color: Vec3, saturation: number, bright: number, contrast: number, roughness: number, wire: number, wireOpacity: number, wireWidth: number } // optimization_mesh_material_controlled; wireWidth: px
  samples: { color: Vec3, roughness: number, size: number } // offset_boundary_material; size: dot diameter (bunny units)
  rays: { color: Vec3, contact: Vec3 } // sampling_ray_material, sampling_contact_material (emission)
  seconds: { sweep: number, rays: number, diffusion: number, coverage: number, optimization: number, thinning: number, transition: number } // timeline lengths, step-to-step camera move
}

// a region with several tetrahedra in the connectivity before the thinning (facing the camera)
const CONNECT_FOCUS: Vec3 = [0.56, 0.629, 0.637]

// the paper Pipeline figure; camera rotation (72.933, 1.0082, 63.761) -> look-at on the view ray
const figureView = (zoom = 1, inset?: StepView['inset']): StepView => ({
  object: structuredClone(FIGURE_OBJECT),
  camera: { location: [0.92946, -0.50082, 0.46088], lookAt: [-0.01906, -0.03964, 0.13713], focalLength: 45 },
  zoom,
  ...(inset ? { inset } : {}),
})

export const OA_DEFAULTS: OaSettings = {
  views: {
    udf: figureView(),
    offset: figureView(),
    sampling: figureView(),
    // on the back: large and small spheres, the two sample sheets around them
    init: figureView(1, { focus: [0.461, 0.53, 0.743], size: 0.1 }),
    // on the back (sphere 6255): lit, facing the camera, the spheres move about twice the median
    optimization: figureView(1.5, { focus: [0.461, 0.53, 0.743], size: 0.07 }),
    connect: figureView(1.5, { focus: CONNECT_FOCUS, size: 0.12 }),
  },
  alpha: 0.027,
  fill: { rotation: [64.12, 0, 75.96], strength: irradiance(55, [4, -1, 2]) },
  rim: { rotation: [38.33, 0, 161.57], strength: irradiance(80, [1, 3, 4]) },
  ground: false,
  slice: { saturation: 1.3, bright: 0, contrast: 0.4, roughness: 1 },
  spheres: { saturation: 1.3, bright: 0, contrast: 1, ao: 0.5, roughness: 0.7, radiusScale: 1.5 },
  mesh: { color: [0.4078, 0.6588, 0.5686], saturation: 1.3, bright: 0, contrast: 1, roughness: 0.7, wire: 0.015, wireOpacity: 1, wireWidth: 1 },
  samples: { color: [0.32, 0.53, 0.73], roughness: 0.5, size: 0.0042 },
  rays: { color: [0.08, 0.25, 0.35], contact: [1, 0.025, 0.005] },
  // the fast forward plays rays 1.5 s, diffusion 1 s, iterations 3.5 s: slower here, for the talk
  seconds: { sweep: 8, rays: 4.5, diffusion: 3, coverage: 6, optimization: 8, thinning: 3, transition: 1.5 },
}

function deepMerge<T>(base: T, over: unknown): T {
  const out = structuredClone(base) as Record<string, unknown>
  if (over && typeof over === 'object') {
    for (const [k, v] of Object.entries(over)) {
      if (!(k in out))
        continue
      out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : structuredClone(v)
    }
  }
  return out as T
}

const saved = savedLook(OA_LOOK_ID) as (LookOverrides & { oa?: unknown }) | undefined
const { oa: savedSettings, ...savedRest } = saved ?? {}
export const OA_LOOK: BlenderLook = mergeLook(OA_PRESET, savedRest)
export const OA_SETTINGS: OaSettings = deepMerge(OA_DEFAULTS, savedSettings)

// UDF slice plane of the figure: a [-1, 1]² plane, then this transform (Blender frame, with the
// object at FIGURE_OBJECT); it is attached to the object, so it follows it
const SLICE = { location: [0.03, 0.02, 0.19] as Vec3, rotation: [94, 0, -83] as Vec3, scale: [0.3, 0.25, 1] as Vec3 }
const SWEEP = 0.27 // the slice sweeps ± this distance along its normal (bunny units)
const AO_NEIGHBORS = 12 // spheres that darken each sphere (the AO of the fast forward material)

// ------------------------------------------------------------------ data

interface Ray { entry: Vec3, exit: Vec3, frames: number[] } // frames: start, at entry, leaves, at exit, leaves, end

interface Manifest {
  bunny: { vertices: number, triangles: number }
  udf: { size: number, min: number, max: number, scale: number }
  colormap: { lut: string, isolines: number[], max: number }
  spheres: { count: number, keyframes: number[], faces: number[] }
  samples: { count: number, total: number }
  // the rays of the fast forward and their schedule (frames of the 2D animation, 20 fps)
  sampling: { rays: Ray[], extent: number, lengthRatio: number, radiusRatio: number, travelRatio: number, markerRatio: number, rayStart: number, diffusionStart: number }
  frames: { sampling2d: number, optimization2d: number, optimizationPlayback: [number, number] }
  // the rays of the 2D sampling animation, drawn live in the browser (oaFrames.ts drawSampling2d)
  sampling2d: { events: { entry: [number, number], exit: [number, number], times: number[] }[], rayEnd: number, frameCount: number }
  // connectivity of the last iteration before the thinning (connect.bin)
  connect: { iteration: number, faces: number, tetFaces: number, removed: number }
}

export interface PipelineData {
  manifest: Manifest
  bunnyPos: Float32Array
  bunnyIndex: Uint32Array
  udf: Uint16Array
  spheres: Float32Array // keyframe × sphere × (x, y, z, r), bunny units
  colors: Uint8Array
  faces: Uint16Array[] // per keyframe, sphere indices
  samplePos: Float32Array
  lut: HTMLImageElement
  connect: { faces: Uint16Array, flags: Uint8Array } // flags: 1 = face of a tetrahedron, 2 = removed by the thinning
}

export const PIPELINE_URL = `${import.meta.env.BASE_URL}oa/pipeline/`

let loading: Promise<PipelineData> | null = null

export function loadPipeline(): Promise<PipelineData> {
  loading ??= (async () => {
    const get = async (f: string) => {
      const res = await fetch(PIPELINE_URL + f)
      if (!res.ok)
        throw new Error(`${f}: HTTP ${res.status}`)
      return res.arrayBuffer()
    }
    const manifest: Manifest = JSON.parse(new TextDecoder().decode(await get('pipeline.json')))
    const [bunny, udf, spheres, colors, faces, samples, connect] = await Promise.all(
      ['bunny.bin', 'udf.bin', 'spheres.bin', 'colors.bin', 'faces.bin', 'samples.bin', 'connect.bin'].map(get),
    )
    const lut = new Image()
    lut.src = PIPELINE_URL + manifest.colormap.lut
    await lut.decode()
    const nv = manifest.bunny.vertices * 3
    let offset = 0
    const faceList = manifest.spheres.faces.map((n) => {
      const a = new Uint16Array(faces, offset, n * 3)
      offset += n * 6
      return a
    })
    return {
      manifest,
      bunnyPos: new Float32Array(bunny, 0, nv),
      bunnyIndex: new Uint32Array(bunny, nv * 4, manifest.bunny.triangles * 3),
      udf: new Uint16Array(udf),
      spheres: new Float32Array(spheres),
      colors: new Uint8Array(colors),
      faces: faceList,
      samplePos: new Float32Array(samples, 0, manifest.samples.count * 3),
      lut,
      connect: {
        faces: new Uint16Array(connect, 0, manifest.connect.faces * 3),
        flags: new Uint8Array(connect, manifest.connect.faces * 6, manifest.connect.faces),
      },
    }
  })()
  return loading
}

// ------------------------------------------------------------------ scenes (one per slide click)

interface SceneSpec {
  shell: number // bunny shell opacity
  solid?: number // shell drawn as an opaque matte surface instead of the paper shell
  tint?: number // paper shell tinted green (the medial axis of the key-idea sketch)
  slice: number // UDF slice opacity
  alphaLine: number // α level drawn on the slice
  sweep?: boolean // slice sweeps through the model (loops)
  rays?: boolean // sampling rays play (the timeline = the ray part of the fast forward schedule)
  samples: number // 0: hidden, 1: all shown; with `grow`, spread from the ray contacts
  grow?: boolean
  spheres: number
  mesh: number
  optimize?: boolean // spheres and mesh play the iterations
  split: boolean // spheres | mesh side by side
  inset?: boolean // zoomed inset of the region of the step view
  bigInset?: boolean // the inset fills the height of the view (no split), next to the main view
  cover?: boolean // the greedy coverage plays: spheres appear largest first, the samples they cover go
  connect?: number // connectivity before the thinning (tetrahedra in orange)
  thin?: boolean // the thinning plays: the faces it removes fade out, the tetrahedra are gone
  iteration?: number // iteration shown (spheres, mesh)
  duration: keyof OaSettings['seconds'] | null // timeline length, null = still
}

const S0: SceneSpec = { shell: 1, slice: 0, alphaLine: 0, samples: 0, spheres: 0, mesh: 0, split: false, duration: null }

export const SCENES: Record<PipelineStep, SceneSpec[]> = {
  udf: [
    { ...S0 },
    { ...S0, slice: 1 },
    { ...S0, slice: 1, sweep: true, duration: 'sweep' },
  ],
  offset: [
    // the surface to extract, then its α-offset on the slice, then the shell turns green with the
    // medial axis of the key-idea sketch
    { ...S0, solid: 1 },
    { ...S0, slice: 1, alphaLine: 1 },
    { ...S0, slice: 1, alphaLine: 1, tint: 1 },
  ],
  sampling: [
    { ...S0, rays: true, duration: 'rays' },
    { ...S0, samples: 1, grow: true, duration: 'diffusion' },
  ],
  init: [
    // the samples (each has a candidate sphere), then the greedy coverage, seen in a large inset
    { ...S0, shell: 0, samples: 1, inset: true, bigInset: true },
    { ...S0, shell: 0, samples: 1, spheres: 1, cover: true, inset: true, bigInset: true, duration: 'coverage' },
  ],
  optimization: [
    // no shell: it would veil the spheres (the paper figure shows them alone)
    // both at iteration 0 first (the initial connectivity is poor: the "initial mesh" slide, and
    // again on the optimization slide once the update is explained), then the iterations
    { ...S0, shell: 0, spheres: 1, mesh: 1, split: true, inset: true },
    { ...S0, shell: 0, spheres: 1, mesh: 1, optimize: true, split: true, inset: true, duration: 'optimization' },
  ],
  connect: [
    // the 3-cliques of the sphere adjacency graph (last iteration), then the thinning
    { ...S0, shell: 0, connect: 1, inset: true, iteration: 119 },
    { ...S0, shell: 0, connect: 1, inset: true, iteration: 119, thin: true, duration: 'thinning' },
  ],
}

export function sceneOf(step: PipelineStep, click: number): SceneSpec {
  const list = SCENES[step]
  return list[Math.max(0, Math.min(list.length - 1, click))]
}

/** Timeline of the scene shown, for the slide UI (2D frames, pause button, iteration). */
export const pipelineClock = reactive({
  key: '',
  progress: 0, // 0..1 of the scene timeline
  duration: 0,
  playing: true,
  iteration: 0,
  frame2d: 1, // 2D frame (file number) of the timeline position
  frame2dExact: 1, // the same, unrounded: the page cross-fades between neighbouring frames
  time2d: 0, // the same position, continuous (frames from 0), for the drawn sampling 2D
  ready: false,
  error: '',
})

// ------------------------------------------------------------------ stage

const LAYER_SPHERES = 1
const LAYER_MESH = 2

interface Panel { x: number, w: number, layers: number[] }

/** A step view in scene terms: object transform (in the Blender-frame `world` group), orbit camera. */
interface Pose { pos: THREE.Vector3, quat: THREE.Quaternion, scale: number, eye: THREE.Vector3, target: THREE.Vector3, focal: number, zoom: number }

/** One sampling ray: a line, its contacts (parameters along it, sorted) and its schedule. */
interface RayPath { origin: THREE.Vector3, dir: THREE.Vector3, ts: number[], frames: number[] }

class PipelineStage {
  el = document.createElement('div')
  ps: PaperScene
  look = OA_LOOK
  settings = OA_SETTINGS
  data: PipelineData | null = null
  step: PipelineStep = 'udf'
  click = 0
  spec: SceneSpec = S0
  cur = { shell: 1, solid: 0, tint: 0, slice: 0, alphaLine: 0, samples: 0, spheres: 0, mesh: 0, rays: 0, connect: 0 }
  last = 0

  // step views: the pose shown, and the move between two steps
  bboxLocal = new THREE.Box3()
  pose: Pose | null = null
  move: { from: Pose, to: Pose, t0: number } | null = null
  shownStep: PipelineStep | null = null

  // objects
  fill = new THREE.DirectionalLight(0xFFFFFF, 1)
  rim = new THREE.DirectionalLight(0xFFFFFF, 1)
  shell: THREE.Mesh[] = []
  shellMaterials: THREE.Material[] = []
  shellUniforms = {
    uSolid: { value: 0 },
    uSolidColor: { value: new THREE.Color(0.72, 0.72, 0.74) }, // light gray, matte (linear)
    uTint: { value: 0 },
    uTintColor: { value: new THREE.Color('#2E9E4F') }, // the green dashes of the key-idea sketch
  }
  shellDepth: THREE.Material | undefined
  // copies of the shell (same geometry), split by the slice: the part behind it is drawn before it
  shellFar: THREE.Mesh[] = []
  shellFarMaterials: THREE.Material[] = []
  farPlane = new THREE.Plane()
  nearPlane = new THREE.Plane()
  farClip = [this.farPlane]
  nearClip = [this.nearPlane]
  clipTmp = { p: new THREE.Vector3(), n: new THREE.Vector3(), c: new THREE.Vector3(), q: new THREE.Quaternion() }
  slice: THREE.Mesh | null = null
  sliceUniforms: Record<string, THREE.IUniform> = {}
  sliceBase = new THREE.Vector3()
  sliceNormal = new THREE.Vector3()
  samples: THREE.Points | null = null
  sampleUniforms: Record<string, THREE.IUniform> = {}
  arrows: THREE.InstancedMesh[] = [] // shafts, heads
  contacts: THREE.InstancedMesh | null = null
  rayPaths: RayPath[] = []
  contactsAlpha = -1
  spheres: THREE.InstancedMesh | null = null
  sphereUniforms: Record<string, THREE.IUniform> = {}
  sphereTexture: THREE.DataTexture | null = null // x, y, z, r (shown) per sphere, for the AO
  sphereRank = new Float32Array() // order of the greedy coverage (largest first), 0..1
  meshPos: THREE.BufferAttribute | null = null
  meshA: THREE.Mesh | null = null
  meshB: THREE.Mesh | null = null
  wire: ThickWire | null = null
  edges: Uint16Array[] = []
  shownIteration = -1
  // connectivity before the thinning: faces kept (not on a tetrahedron), kept tetrahedron faces,
  // removed faces; edges before / after
  connectMeshes: THREE.Mesh[] = []
  connectWires: ThickWire[] = []

  // zoomed inset: focus in world units, its own camera (fixed to the bunny: the eye of the Step 4
  // view, in bunny units), the panels of the last frame (for picking), the frames
  // [marker, inset] × [spheres, mesh] drawn over the canvas
  focus = new THREE.Vector3()
  insetCamera = new THREE.PerspectiveCamera(10, 1, 0.001, 100)
  insetEye = new THREE.Vector3()
  panels: Panel[] = []
  frames: HTMLDivElement[] = []
  picking: ((focus: Vec3) => void) | null = null

  constructor() {
    this.el.style.cssText = 'position:absolute;inset:0'
    const ps = this.ps = createPaperScene(this.el)
    for (let i = 0; i < 4; i++) {
      const f = document.createElement('div')
      f.style.cssText = `position:absolute;left:0;top:0;display:none;pointer-events:none;box-sizing:border-box;border:${i % 2 ? 1 : 1.5}px solid var(--deck-oa, #B4553F)`
      this.el.appendChild(f)
      this.frames.push(f)
    }
    for (const l of [this.fill, this.rim]) {
      l.layers.enableAll()
      ps.sun.parent!.add(l)
      l.target = ps.sun.target
    }
    applyLook(ps, this.look)
    ps.sun.layers.enableAll()
    ps.ambient.layers.enableAll()
    ps.ground.layers.enableAll()
    ps.sun.shadow.camera.layers.enableAll()
    ps.onFrame.add(now => this.frame(now))
    ps.render = () => this.render()
    ps.renderer.domElement.addEventListener('click', e => this.pick(e))
    loadPipeline().then(d => this.build(d)).catch((e) => {
      pipelineClock.error = String(e)
      console.error('OffsetAxis pipeline data', e)
    })
  }

  // ---------------------------------------------------------------- building

  build(d: PipelineData) {
    this.data = d
    const { ps } = this
    // bunny: the shell of the fast forward (stage3_input_surface), with an opacity for the fades
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(d.bunnyPos, 3))
    geo.setIndex(new THREE.BufferAttribute(d.bunnyIndex, 1))
    geo.computeVertexNormals()
    for (const side of [THREE.BackSide, THREE.FrontSide]) {
      const m = fadingShell(createPaperShellMaterial(side, ps.paper), this.shellUniforms)
      const mesh = new THREE.Mesh(geo, m)
      mesh.renderOrder = 2
      mesh.layers.enable(LAYER_SPHERES)
      if (side === THREE.FrontSide) {
        mesh.castShadow = true
        mesh.customDepthMaterial = this.shellDepth = createPaperShellDepthMaterial(ps.paper)
      }
      ps.content.add(mesh)
      this.shell.push(mesh)
      this.shellMaterials.push(m)
    }
    for (const side of [THREE.BackSide, THREE.FrontSide]) {
      const m = fadingShell(createPaperShellMaterial(side, ps.paper), this.shellUniforms)
      const mesh = new THREE.Mesh(geo, m)
      mesh.renderOrder = 0
      mesh.layers.enable(LAYER_SPHERES)
      mesh.visible = false
      ps.content.add(mesh)
      this.shellFar.push(mesh)
      this.shellFarMaterials.push(m)
    }

    geo.computeBoundingBox()
    this.bboxLocal.copy(geo.boundingBox!)

    this.buildSlice(d)
    this.buildSamples(d)
    this.buildSpheres(d)
    this.buildConnect(d)
    this.computeCoverage(d)
    this.applyPose(this.poseOf(this.settings.views[this.step]))
    this.shownStep = this.step
    this.setLook(this.look)
    pipelineClock.ready = true
    this.apply(true)
  }

  buildSlice(d: PipelineData) {
    const { udf: u, colormap } = d.manifest
    const half = new Uint16Array(d.udf.length)
    for (let i = 0; i < half.length; i++)
      half[i] = THREE.DataUtils.toHalfFloat(d.udf[i] / 65535 * u.scale)
    const tex = new THREE.Data3DTexture(half, u.size, u.size, u.size)
    tex.format = THREE.RedFormat
    tex.type = THREE.HalfFloatType
    tex.minFilter = tex.magFilter = THREE.LinearFilter
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping
    tex.unpackAlignment = 1
    tex.needsUpdate = true
    const lut = new THREE.Texture(d.lut)
    lut.colorSpace = THREE.SRGBColorSpace
    lut.minFilter = lut.magFilter = THREE.LinearFilter
    lut.generateMipmaps = false
    lut.needsUpdate = true

    const lines = colormap.isolines.slice(0, 32)
    while (lines.length < 32)
      lines.push(-1)
    this.sliceUniforms = {
      uUdf: { value: tex },
      uLut: { value: lut },
      uToLocal: { value: new THREE.Matrix4() },
      uGridMin: { value: u.min },
      uGridMax: { value: u.max },
      uMax: { value: colormap.max },
      uLines: { value: lines },
      uAlpha: { value: this.settings.alpha },
      uAlphaOn: { value: 0 },
      uAlphaColor: { value: new THREE.Color('#00A7C4') },
      uNodes: { value: new THREE.Vector3() }, // saturation, bright, contrast
    }
    // Figure_UDF_slice_material: RdBu texture -> HSV -> Bright/Contrast -> Principled (lit)
    const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, transparent: true, metalness: 0 })
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.sliceUniforms)
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'uniform mat4 uToLocal;\nvarying vec3 vLocal;\nvoid main() {\nvLocal = (uToLocal * vec4(position, 1.0)).xyz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', `${FF_COLOR_GLSL}\n${SLICE_GLSL}\nvoid main() {`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb = sliceColor();`)
    }
    material.customProgramCacheKey = () => 'oa-slice'
    const plane = this.slice = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    // the plane of the figure, expressed relative to the object of the figure
    const object = new THREE.Matrix4().compose(
      new THREE.Vector3(...FIGURE_OBJECT.location),
      new THREE.Quaternion().setFromEuler(blenderEuler(FIGURE_OBJECT.rotation)),
      new THREE.Vector3().setScalar(FIGURE_OBJECT.scale),
    )
    const world = new THREE.Matrix4().compose(
      new THREE.Vector3(...SLICE.location),
      new THREE.Quaternion().setFromEuler(blenderEuler(SLICE.rotation)),
      new THREE.Vector3(...SLICE.scale),
    )
    object.invert().multiply(world).decompose(plane.position, plane.quaternion, plane.scale)
    this.sliceBase.copy(plane.position)
    this.sliceNormal.set(0, 0, 1).applyQuaternion(plane.quaternion).normalize()
    plane.renderOrder = 1
    plane.receiveShadow = true
    this.ps.content.add(plane)
  }

  /** While the slice is visible, the shell is split by its plane: the near part (camera side) is
   * drawn over the slice, the far part under it, so the slice covers it during the whole fade. */
  updateShellClip() {
    const { p, n, c, q } = this.clipTmp
    const on = this.cur.slice > 0.01
    if (on) {
      // slice plane in world space; the normal points to the camera side (sign s)
      this.slice!.getWorldPosition(p)
      n.set(0, 0, 1).applyQuaternion(this.slice!.getWorldQuaternion(q)).normalize()
      const s = Math.sign(n.dot(this.ps.camera.getWorldPosition(c).sub(p))) || 1
      // clipping keeps the points with distanceToPoint >= 0
      this.nearPlane.setFromNormalAndCoplanarPoint(n.multiplyScalar(s), p)
      this.farPlane.setFromNormalAndCoplanarPoint(n.multiplyScalar(-1), p)
    }
    // the program changes only when the plane count does (null <-> one plane)
    for (const m of this.shellMaterials) {
      if (!!m.clippingPlanes !== on)
        m.needsUpdate = true
      m.clippingPlanes = on ? this.nearClip : null
    }
    this.shellFarMaterials.forEach((m, i) => {
      const orig = this.shellMaterials[i]
      if (!!m.clippingPlanes !== on)
        m.needsUpdate = true
      m.clippingPlanes = on ? this.farClip : null
      ;(m as THREE.MeshLambertMaterial).opacity = this.cur.shell
      m.depthWrite = orig.depthWrite
      this.shellFar[i].visible = on && this.cur.shell > 0.01
    })
  }

  buildSamples(d: PipelineData) {
    const { ps } = this
    const n = d.manifest.samples.count
    const pos = d.samplePos
    const sm = d.manifest.sampling
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aReveal', new THREE.BufferAttribute(new Float32Array(n), 1)) // computeContacts
    geo.setAttribute('aCover', new THREE.BufferAttribute(new Float32Array(n), 1)) // computeCoverage
    geo.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(3 * n), 3))
    this.sampleUniforms = {
      uSize: { value: 0 },
      uViewportHeight: { value: 500 },
      uColor: { value: new THREE.Color() },
      uProgress: { value: 0 },
      uCover: { value: -1 }, // coverage time (-1: off)
      uOpacity: { value: 0 },
      uLightDir: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
      uLightE: { value: [0, 0, 0] },
      uAmbient: { value: 0 },
    }
    const material = new THREE.ShaderMaterial({ uniforms: this.sampleUniforms, vertexShader: POINTS_VERT, fragmentShader: POINTS_FRAG, transparent: true })
    this.samples = new THREE.Points(geo, material)
    this.samples.frustumCulled = false
    ps.content.add(this.samples)

    // rays: arrows of the fast forward (shaft + cone, tip at the origin, pointing +Y)
    const L = sm.extent * sm.lengthRatio
    const r = sm.extent * sm.radiusRatio
    const shaft = new THREE.CylinderGeometry(r, r, L, 12).translate(0, -0.62 * L, 0)
    const head = new THREE.ConeGeometry(3 * r, 0.12 * L, 16).translate(0, -0.06 * L, 0)
    const rayMat = new THREE.MeshBasicMaterial({ transparent: true }) // emission
    const count = sm.rays.length
    this.arrows = [shaft, head].map(g => new THREE.InstancedMesh(g, rayMat, count))
    const dotMat = new THREE.MeshBasicMaterial({ transparent: true })
    this.contacts = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(sm.extent * sm.markerRatio, 2), dotMat, 32 * count)
    for (const m of [...this.arrows, this.contacts]) {
      m.frustumCulled = false
      m.visible = false
      m.layers.enable(LAYER_SPHERES)
      ps.content.add(m)
    }
  }

  buildSpheres(d: PipelineData) {
    const { ps } = this
    const n = d.manifest.spheres.count
    const width = 128
    this.sphereTexture = new THREE.DataTexture(new Float32Array(width * Math.ceil(n / width) * 4), width, Math.ceil(n / width), THREE.RGBAFormat, THREE.FloatType)
    const neighbors = sphereNeighbors(d.spheres.subarray(0, n * 4), AO_NEIGHBORS, this.settings.spheres.radiusScale)
    const nTexture = new THREE.DataTexture(neighbors, 256, neighbors.length / 4 / 256, THREE.RGBAFormat, THREE.FloatType)
    nTexture.needsUpdate = true
    this.sphereUniforms = {
      uSpheres: { value: this.sphereTexture },
      uNeighbors: { value: nTexture },
      uNodes: { value: new THREE.Vector3() }, // saturation, bright, contrast
      uAoFac: { value: 0.5 },
    }
    const material = fastForwardSpheres(new THREE.MeshStandardMaterial({ transparent: true, metalness: 0 }), this.sphereUniforms)
    const spheres = this.spheres = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 3), material, n)
    const c = new THREE.Color()
    for (let i = 0; i < n; i++) {
      // Attribute Col of the fast forward: a float colour = the PLY bytes / 255, used as linear
      c.setRGB(d.colors[3 * i] / 255, d.colors[3 * i + 1] / 255, d.colors[3 * i + 2] / 255, THREE.LinearSRGBColorSpace)
      spheres.setColorAt(i, c)
    }
    spheres.layers.set(LAYER_SPHERES)
    spheres.castShadow = true
    spheres.receiveShadow = true
    spheres.frustumCulled = false
    ps.content.add(spheres)

    // reconstructed mesh: vertices = sphere centres; faces of keyframe k (A) fading into k + 1 (B)
    const posArray = new Float32Array(n * 3)
    this.meshPos = new THREE.BufferAttribute(posArray, 3).setUsage(THREE.DynamicDrawUsage)
    const make = (opacity: number) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', this.meshPos!)
      const m = new THREE.MeshStandardMaterial({ metalness: 0, flatShading: true, side: THREE.DoubleSide, transparent: opacity < 1, opacity, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
      const mesh = new THREE.Mesh(g, m)
      mesh.layers.set(LAYER_MESH)
      mesh.castShadow = true
      mesh.frustumCulled = false
      ps.content.add(mesh)
      return mesh
    }
    this.meshA = make(1)
    this.meshB = make(0.5)
    this.meshB.castShadow = false
    ;(this.meshB.material as THREE.Material).depthFunc = THREE.LessEqualDepth
    this.edges = d.faces.map(edgesOf)
    this.wire = new ThickWire(Math.max(...this.edges.map(e => e.length / 2)))
    this.wire.line.layers.set(LAYER_MESH)
    ps.content.add(this.wire.line)
    this.setIteration(0)
  }

  buildConnect(d: PipelineData) {
    const groups: number[][] = [[], [], []]
    const { faces, flags } = d.connect
    for (let i = 0; i < flags.length; i++)
      groups[flags[i] & 2 ? 2 : flags[i] & 1 ? 1 : 0].push(faces[3 * i], faces[3 * i + 1], faces[3 * i + 2])
    this.connectMeshes = groups.map((g) => {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', this.meshPos!)
      geo.setIndex(g)
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ metalness: 0, flatShading: true, side: THREE.DoubleSide, transparent: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }))
      m.frustumCulled = false
      m.visible = false
      m.castShadow = true
      this.ps.content.add(m)
      return m
    })
    const before = new Uint16Array(groups.flat())
    const after = new Uint16Array([...groups[0], ...groups[1]])
    this.connectWires = [before, after].map((f) => {
      const edges = edgesOf(f)
      const w = new ThickWire(edges.length / 2)
      w.set(edges, this.meshPos!.array as Float32Array)
      w.line.visible = false
      this.ps.content.add(w.line)
      return w
    })
  }

  // ---------------------------------------------------------------- ray contacts

  /** UDF of the bunny at a point (bunny units), trilinear in the grid. */
  udfAt(p: THREE.Vector3): number {
    const { udf: u } = this.data!.manifest
    const g = this.data!.udf
    const n = u.size
    const c = (v: number) => Math.min(n - 1.001, Math.max(0, (v - u.min) / (u.max - u.min) * (n - 1)))
    const x = c(p.x)
    const y = c(p.y)
    const z = c(p.z)
    const i = Math.floor(x)
    const j = Math.floor(y)
    const k = Math.floor(z)
    const fx = x - i
    const fy = y - j
    const fz = z - k
    const at = (a: number, b: number, e: number) => g[(i + a) + (j + b) * n + (k + e) * n * n]
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t
    const v = lerp(
      lerp(lerp(at(0, 0, 0), at(1, 0, 0), fx), lerp(at(0, 1, 0), at(1, 1, 0), fx), fy),
      lerp(lerp(at(0, 0, 1), at(1, 0, 1), fx), lerp(at(0, 1, 1), at(1, 1, 1), fx), fy),
      fz,
    )
    return v / 65535 * u.scale
  }

  /**
   * Contacts of the rays: the lines of the fast forward rays (through their two samples), where
   * the UDF = α along them. The α level set has a sheet on each side of the surface, so a ray
   * leaves two contacts each time it crosses the surface. Then the diffusion order of the samples:
   * distance to the nearest contact, as in the fast forward.
   */
  computeContacts() {
    const d = this.data!
    const sm = d.manifest.sampling
    const alpha = this.contactsAlpha = this.settings.alpha
    const step = 0.0015
    const reach = sm.extent * sm.travelRatio
    const p = new THREE.Vector3()
    this.rayPaths = sm.rays.map((r) => {
      const origin = new THREE.Vector3(...r.entry)
      const exit = new THREE.Vector3(...r.exit)
      const length = exit.distanceTo(origin)
      const dir = exit.sub(origin).normalize()
      const ts: number[] = []
      let prev = this.udfAt(p.copy(origin).addScaledVector(dir, -reach)) - alpha
      for (let t = -reach + step; t <= length + reach; t += step) {
        const v = this.udfAt(p.copy(origin).addScaledVector(dir, t)) - alpha
        if ((v < 0) !== (prev < 0))
          ts.push(t - step * v / (v - prev))
        prev = v
      }
      return { origin, dir, ts: ts.length >= 2 ? ts : [0, length], frames: r.frames }
    })
    const points = this.rayPaths.flatMap(r => r.ts.map(t => r.origin.clone().addScaledVector(r.dir, t)))
    const pos = d.samplePos
    const attr = this.samples!.geometry.getAttribute('aReveal') as THREE.BufferAttribute
    const reveal = attr.array as Float32Array
    let max = 0
    for (let i = 0; i < reveal.length; i++) {
      let m = Infinity
      for (const q of points)
        m = Math.min(m, (pos[3 * i] - q.x) ** 2 + (pos[3 * i + 1] - q.y) ** 2 + (pos[3 * i + 2] - q.z) ** 2)
      reveal[i] = Math.sqrt(m)
      max = Math.max(max, reveal[i])
    }
    for (let i = 0; i < reveal.length; i++)
      reveal[i] /= max
    attr.needsUpdate = true
  }

  /**
   * The greedy coverage, rebuilt from the spheres it selected (iteration 0): taken largest first,
   * each sphere covers the samples within its radius + δ that no earlier sphere covers. Per sample:
   * the rank of the sphere that covers it and its colour (the sphere colour, through the nodes).
   */
  computeCoverage(d: PipelineData) {
    const n = d.manifest.spheres.count
    const sp = d.spheres
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => sp[4 * b + 3] - sp[4 * a + 3])
    const rank = this.sphereRank = new Float32Array(n)
    order.forEach((i, k) => rank[i] = k / Math.max(1, n - 1))
    let reach = 0
    for (let i = 0; i < n; i++)
      reach = Math.max(reach, sp[4 * i + 3] + COVER_DELTA)
    const cell = (v: number) => Math.floor(v / reach)
    const cells = new Map<string, number[]>()
    for (let i = 0; i < n; i++) {
      const c = `${cell(sp[4 * i])},${cell(sp[4 * i + 1])},${cell(sp[4 * i + 2])}`
      if (!cells.has(c))
        cells.set(c, [])
      cells.get(c)!.push(i)
    }
    const geo = this.samples!.geometry
    const cover = geo.getAttribute('aCover').array as Float32Array
    const tint = geo.getAttribute('aTint').array as Float32Array
    const pos = d.samplePos
    const { saturation, bright, contrast } = this.settings.spheres
    for (let i = 0; i < cover.length; i++) {
      const x = pos[3 * i]
      const y = pos[3 * i + 1]
      const z = pos[3 * i + 2]
      let best = -1 // earliest covering sphere, else the nearest dilated support
      let gap = Infinity
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          for (let c = -1; c <= 1; c++) {
            for (const j of cells.get(`${cell(x) + a},${cell(y) + b},${cell(z) + c}`) ?? []) {
              const g = Math.hypot(sp[4 * j] - x, sp[4 * j + 1] - y, sp[4 * j + 2] - z) - sp[4 * j + 3] - COVER_DELTA
              const covers = g <= 0
              if (covers ? gap > 0 || rank[j] < rank[best] : gap > 0 && g < gap) {
                best = j
                gap = covers ? 0 : g
              }
            }
          }
        }
      }
      cover[i] = best < 0 ? 1 : rank[best]
      const col = best < 0 ? [1, 1, 1] as Vec3 : ffColor([d.colors[3 * best] / 255, d.colors[3 * best + 1] / 255, d.colors[3 * best + 2] / 255], saturation, bright, contrast)
      tint.set(col, 3 * i)
    }
    geo.getAttribute('aCover').needsUpdate = true
    geo.getAttribute('aTint').needsUpdate = true
  }

  /** Spheres of iteration 0 at time t of the coverage: each grows in when its turn comes. */
  setCoverage(t: number) {
    const d = this.data!
    const n = d.manifest.spheres.count
    const scale = this.settings.spheres.radiusScale
    const m = new THREE.Matrix4()
    const p = this.meshPos!.array as Float32Array
    const tex = this.sphereTexture!.image.data as Float32Array
    for (let i = 0; i < n; i++) {
      const g = THREE.MathUtils.smoothstep(t, this.sphereRank[i] * COVER_SPAN, this.sphereRank[i] * COVER_SPAN + COVER_GROW)
      const r = d.spheres[4 * i + 3] * scale * g
      m.makeScale(r, r, r).setPosition(d.spheres[4 * i], d.spheres[4 * i + 1], d.spheres[4 * i + 2])
      this.spheres!.setMatrixAt(i, m)
      tex[4 * i] = p[3 * i] = d.spheres[4 * i]
      tex[4 * i + 1] = p[3 * i + 1] = d.spheres[4 * i + 1]
      tex[4 * i + 2] = p[3 * i + 2] = d.spheres[4 * i + 2]
      tex[4 * i + 3] = r
    }
    this.spheres!.instanceMatrix.needsUpdate = true
    this.sphereTexture!.needsUpdate = true
    this.meshPos!.needsUpdate = true
    this.wire!.refresh(p)
    this.shownIteration = -1 // full radii again after the coverage
  }

  // ---------------------------------------------------------------- step views

  /** The pose of a step view: the camera orbits the point of its view ray nearest to the object. */
  poseOf(v: StepView): Pose {
    const pos = new THREE.Vector3(...v.object.location)
    const quat = new THREE.Quaternion().setFromEuler(blenderEuler(v.object.rotation))
    const center = this.bboxLocal.isEmpty() ? pos.clone() : this.bboxLocal.getCenter(new THREE.Vector3()).multiplyScalar(v.object.scale).applyQuaternion(quat).add(pos)
    const eye = new THREE.Vector3(...v.camera.location)
    const dir = new THREE.Vector3(...v.camera.lookAt).sub(eye).normalize()
    const pivot = eye.clone().addScaledVector(dir, Math.max(0.1, center.clone().sub(eye).dot(dir)))
    return {
      pos,
      quat,
      scale: v.object.scale,
      eye: new THREE.Vector3(...blenderToThree(v.camera.location)),
      target: new THREE.Vector3(...blenderToThree(pivot.toArray() as Vec3)),
      focal: v.camera.focalLength,
      zoom: v.zoom,
    }
  }

  /** The pose shown now (the camera may have been moved with the mouse). */
  currentPose(): Pose {
    const { content, camera, controls } = this.ps
    return {
      pos: content.position.clone(),
      quat: content.quaternion.clone(),
      scale: content.scale.x,
      eye: camera.position.clone(),
      target: controls.target.clone(),
      focal: this.pose?.focal ?? 45,
      zoom: this.pose?.zoom ?? 1,
    }
  }

  applyPose(p: Pose) {
    const { ps } = this
    this.pose = p
    ps.content.position.copy(p.pos)
    ps.content.quaternion.copy(p.quat)
    ps.content.scale.setScalar(p.scale)
    ps.content.updateMatrixWorld(true)
    ps.camera.position.copy(p.eye)
    ps.controls.target.copy(p.target)
    ps.camera.lookAt(p.target)
    ps.controls.update()
    // shadow catcher at the lowest point of the object (corners of its box: cheap)
    if (!this.bboxLocal.isEmpty()) {
      const box = this.bboxLocal.clone().applyMatrix4(ps.content.matrix)
      ps.objectMinZ = box.min.z
      box.getCenter(ps.objectCenter)
      if (this.look.shadowCatcher.contact)
        ps.ground.position.z = box.min.z
    }
  }

  /** Goes to the view of the step shown: moves there from the current pose, or jumps. */
  goToView(jump: boolean) {
    const to = this.poseOf(this.settings.views[this.step])
    if (jump || !this.pose)
      this.applyPose(to)
    else
      this.move = { from: this.currentPose(), to, t0: performance.now() }
  }

  /** Re-applies the view of the step shown (the dev panel changed it). */
  refreshView() {
    this.move = null
    this.goToView(true)
  }

  // ---------------------------------------------------------------- look and settings

  /** Applies a look (lights, film, shadow catcher, shell; the objects and cameras are the step views). */
  setLook(look: BlenderLook) {
    this.look = look
    const { ps } = this
    ps.sun.target.position.copy(ps.objectCenter)
    applyLook(ps, look)
    if (this.pose && look.shadowCatcher.contact)
      ps.ground.position.z = ps.objectMinZ
    this.applySettings()
  }

  /** Applies OA_SETTINGS-like values (lights, materials): from the dev panel. */
  applySettings(settings = this.settings) {
    this.settings = settings
    const { ps } = this
    for (const [light, s] of [[this.fill, settings.fill], [this.rim, settings.rim]] as const) {
      light.intensity = s.strength
      light.position.copy(ps.sun.target.position).addScaledVector(blenderSunDirection(s.rotation), -8)
    }
    ps.ground.visible = settings.ground
    if (!this.data)
      return
    const lin = (c: Vec3, out: THREE.Color) => out.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace)
    const { slice, spheres, mesh, samples, rays } = settings
    ;(this.sliceUniforms.uNodes.value as THREE.Vector3).set(slice.saturation, slice.bright, slice.contrast)
    ;(this.slice!.material as THREE.MeshStandardMaterial).roughness = slice.roughness
    ;(this.sphereUniforms.uNodes.value as THREE.Vector3).set(spheres.saturation, spheres.bright, spheres.contrast)
    this.sphereUniforms.uAoFac.value = spheres.ao
    ;(this.spheres!.material as THREE.MeshStandardMaterial).roughness = spheres.roughness
    for (const m of [this.meshA!, this.meshB!]) {
      const mat = m.material as THREE.MeshStandardMaterial
      lin(ffColor(mesh.color, mesh.saturation, mesh.bright, mesh.contrast), mat.color)
      mat.roughness = mesh.roughness
    }
    for (const m of this.connectMeshes)
      (m.material as THREE.MeshStandardMaterial).roughness = mesh.roughness
    for (const w of [this.wire!, ...this.connectWires]) {
      w.material.color.setRGB(mesh.wire, mesh.wire, mesh.wire, THREE.LinearSRGBColorSpace)
      w.material.opacity = mesh.wireOpacity
      w.material.linewidth = mesh.wireWidth
    }
    lin(samples.color, this.sampleUniforms.uColor.value)
    this.sampleUniforms.uSize.value = samples.size
    lin(rays.color, (this.arrows[0].material as THREE.MeshBasicMaterial).color)
    lin(rays.contact, (this.contacts!.material as THREE.MeshBasicMaterial).color)
    this.sliceUniforms.uAlpha.value = settings.alpha
    if (settings.alpha !== this.contactsAlpha)
      this.computeContacts()
    this.shownIteration = -1 // sphere radii follow radiusScale
    if (this.spec.duration)
      pipelineClock.duration = settings.seconds[this.spec.duration]
  }

  /** The next click on the 3D view sets the inset focus of the step shown (the point of the bunny
   * under the mouse). */
  startPicking(done: (focus: Vec3) => void) {
    this.picking = done
    this.ps.renderer.domElement.style.cursor = 'crosshair'
  }

  pick(e: MouseEvent) {
    if (!this.picking || !this.data)
      return
    const { camera, content, renderer, size } = this.ps
    // the slide is scaled: screen pixels -> canvas CSS pixels (the units of the panels)
    const r = renderer.domElement.getBoundingClientRect()
    const x = (e.clientX - r.left) * size.width / r.width
    const y = (e.clientY - r.top) * size.height / r.height
    const panel = this.panels.find(p => x >= p.x && x < p.x + p.w) ?? this.panels[0]
    if (!panel)
      return
    this.setupCamera(panel.w, size.height)
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2((x - panel.x) / panel.w * 2 - 1, 1 - y / size.height * 2), camera)
    const hit = ray.intersectObject(this.shell[1], false)[0]
    if (!hit)
      return
    const p = content.worldToLocal(hit.point.clone())
    const view = this.settings.views[this.step]
    view.inset ??= { focus: [0, 0, 0], size: 0.07 }
    view.inset.focus = [p.x, p.y, p.z].map(v => Math.round(v * 1000) / 1000) as Vec3
    renderer.domElement.style.cursor = ''
    const done = this.picking
    this.picking = null
    done(view.inset.focus)
  }

  // ---------------------------------------------------------------- state

  show(step: PipelineStep, click: number) {
    const key = `${step}:${click}`
    if (key === pipelineClock.key)
      return
    this.step = step
    this.click = click
    this.spec = sceneOf(step, click)
    if (step !== this.shownStep && this.data) {
      this.goToView(this.shownStep === null)
      this.shownStep = step
    }
    pipelineClock.key = key
    pipelineClock.progress = 0
    pipelineClock.duration = this.spec.duration ? this.settings.seconds[this.spec.duration] : 0
    pipelineClock.playing = pipelineClock.duration > 0
    if (this.spec.iteration !== undefined)
      pipelineClock.iteration = this.spec.iteration
    else if (!this.spec.optimize)
      pipelineClock.iteration = this.spec.spheres ? 0 : pipelineClock.iteration
    this.apply(false)
  }

  /** Moves the canvas into `host` (the slide being shown). */
  attach(host: HTMLElement) {
    if (this.el.parentElement !== host)
      host.appendChild(this.el)
  }

  apply(instant: boolean) {
    if (instant) {
      const s = this.spec
      Object.assign(this.cur, { shell: s.shell, solid: s.solid ?? 0, tint: s.tint ?? 0, slice: s.slice, alphaLine: s.alphaLine, samples: s.samples && !s.grow ? 1 : 0, spheres: s.spheres, mesh: s.mesh, rays: s.rays ? 1 : 0, connect: s.connect ?? 0 })
    }
  }

  frame(now: number) {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0
    this.last = now
    if (!this.data)
      return
    const s = this.spec
    const clock = pipelineClock
    if (clock.playing && clock.duration > 0) {
      clock.progress += dt / clock.duration
      if (clock.progress >= 1) {
        if (s.sweep)
          clock.progress -= 1
        else {
          clock.progress = 1
          clock.playing = false
        }
      }
    }
    // fades toward the scene values
    const k = 1 - Math.exp(-dt / 0.18)
    const ease = (key: keyof typeof this.cur, target: number) => {
      this.cur[key] += (target - this.cur[key]) * k
      if (Math.abs(target - this.cur[key]) < 1e-3)
        this.cur[key] = target
    }
    ease('shell', s.shell)
    ease('solid', s.solid ?? 0)
    ease('tint', s.tint ?? 0)
    ease('slice', s.slice)
    ease('alphaLine', s.alphaLine)
    ease('samples', s.samples)
    ease('spheres', s.spheres)
    ease('mesh', s.mesh)
    ease('rays', s.rays || s.grow ? 1 : 0)
    // move between two step views (eased)
    if (this.move) {
      const { from, to, t0 } = this.move
      const t = Math.min(1, (now - t0) / 1000 / Math.max(0.01, this.settings.seconds.transition))
      const e = t * t * (3 - 2 * t)
      this.applyPose({
        pos: from.pos.clone().lerp(to.pos, e),
        quat: from.quat.clone().slerp(to.quat, e),
        scale: THREE.MathUtils.lerp(from.scale, to.scale, e),
        eye: from.eye.clone().lerp(to.eye, e),
        target: from.target.clone().lerp(to.target, e),
        focal: THREE.MathUtils.lerp(from.focal, to.focal, e),
        zoom: THREE.MathUtils.lerp(from.zoom, to.zoom, e),
      })
      if (t >= 1)
        this.move = null
    }

    for (const m of this.shellMaterials)
      (m as THREE.MeshLambertMaterial).opacity = this.cur.shell
    for (const mesh of this.shell)
      mesh.visible = this.cur.shell > 0.01
    // solid: the front faces hide each other and cast a full shadow
    const solid = this.cur.solid > 0.5
    this.shellUniforms.uSolid.value = this.cur.solid
    this.shellUniforms.uTint.value = this.cur.tint
    this.shellMaterials[1].depthWrite = solid
    this.shell[1].customDepthMaterial = solid ? undefined : this.shellDepth

    // slice
    const slice = this.slice!
    slice.visible = this.cur.slice > 0.01
    const offset = s.sweep ? -SWEEP * Math.sin(clock.progress * Math.PI * 2) : 0
    const target = this.sliceBase.clone().addScaledVector(this.sliceNormal, offset)
    slice.position.lerp(target, s.sweep ? 1 : k)
    ;(slice.material as THREE.MeshStandardMaterial).opacity = this.cur.slice
    // while it fades, the slice must not hide what is behind it (the shell is drawn after it)
    ;(slice.material as THREE.MeshStandardMaterial).depthWrite = this.cur.slice > 0.99
    this.sliceUniforms.uAlphaOn.value = this.cur.alphaLine
    slice.updateMatrixWorld()
    this.updateShellClip()
    this.sliceUniforms.uToLocal.value.copy(this.ps.content.matrixWorld).invert().multiply(slice.matrixWorld)

    // sampling: frame of the fast forward schedule (20 fps)
    const sm = this.data.manifest.sampling
    let f = -1
    if (s.rays)
      f = sm.rayStart + clock.progress * (sm.diffusionStart - sm.rayStart)
    else if (s.grow)
      f = sm.diffusionStart + clock.progress * (this.data!.manifest.frames.sampling2d - sm.diffusionStart)
    // 2D frame files are numbered from 1 (frame 0)
    if (this.step === 'sampling') {
      clock.frame2dExact = Math.min(this.data!.manifest.frames.sampling2d, Math.max(f, sm.rayStart) + 1)
      clock.frame2d = Math.round(clock.frame2dExact)
      clock.time2d = Math.max(f, sm.rayStart)
    }
    else if (this.step === 'optimization') {
      const [a, b] = this.data.manifest.frames.optimizationPlayback
      clock.frame2dExact = s.optimize ? Math.min(this.data.manifest.frames.optimization2d, a + clock.progress * (b - a) + 1) : 1
      clock.frame2d = Math.round(clock.frame2dExact)
    }
    this.updateRays(f)

    const samples = this.samples!
    samples.visible = this.cur.samples > 0.01
    this.sampleUniforms.uOpacity.value = this.cur.samples
    this.sampleUniforms.uProgress.value = s.grow ? clock.progress * 1.02 : 1.02
    // coverage: kept while the samples fade out on the next step (they would come back otherwise)
    if (s.cover)
      this.sampleUniforms.uCover.value = clock.progress
    else if (s.samples > 0)
      this.sampleUniforms.uCover.value = -1
    this.updatePointLights()

    // spheres and mesh
    if (s.optimize)
      clock.iteration = this.iterationAt(clock.progress)
    this.spheres!.visible = this.cur.spheres > 0.01
    ;(this.spheres!.material as THREE.MeshStandardMaterial).opacity = this.cur.spheres
    ;(this.spheres!.material as THREE.MeshStandardMaterial).transparent = this.cur.spheres < 1
    this.meshA!.visible = this.meshB!.visible = this.wire!.line.visible = this.cur.mesh > 0.01
    if (s.cover)
      this.setCoverage(clock.progress)
    else if (clock.iteration !== this.shownIteration)
      this.setIteration(clock.iteration)

    // connectivity, then the thinning: removed faces fade out, kept tetrahedron faces turn green
    ease('connect', s.connect ?? 0)
    const thin = s.thin ? clock.progress : 0
    const [rest, tets, removed] = this.connectMeshes
    const [before, after] = this.connectWires
    const on = this.cur.connect > 0.01
    const green = (this.meshA!.material as THREE.MeshStandardMaterial).color
    ;(rest.material as THREE.MeshStandardMaterial).color.copy(green)
    ;(tets.material as THREE.MeshStandardMaterial).color.copy(TET_ORANGE).lerp(green, thin)
    ;(removed.material as THREE.MeshStandardMaterial).color.copy(TET_ORANGE)
    rest.visible = tets.visible = on
    removed.visible = on && thin < 0.99
    for (const m of [rest, tets])
      (m.material as THREE.MeshStandardMaterial).opacity = this.cur.connect
    ;(removed.material as THREE.MeshStandardMaterial).opacity = this.cur.connect * (1 - thin)
    const wireOpacity = this.settings.mesh.wireOpacity * this.cur.connect
    before.line.visible = on && thin < 0.99
    after.line.visible = on && thin > 0.01
    before.material.opacity = wireOpacity * (1 - thin)
    after.material.opacity = wireOpacity * thin
  }

  /** Keyframe index space played at constant speed: the early iterations (most motion) last longer. */
  iterationAt(p: number): number {
    const kf = this.data!.manifest.spheres.keyframes
    const x = Math.min(0.9999, Math.max(0, p)) * (kf.length - 1)
    const i = Math.floor(x)
    return kf[i] + (kf[i + 1] - kf[i]) * (x - i)
  }

  setIteration(it: number) {
    const d = this.data!
    this.shownIteration = it
    const kf = d.manifest.spheres.keyframes
    let k = 0
    while (k < kf.length - 2 && kf[k + 1] <= it)
      k++
    const f = Math.min(1, Math.max(0, (it - kf[k]) / (kf[k + 1] - kf[k])))
    const n = d.manifest.spheres.count
    const a = k * n * 4
    const b = (k + 1) * n * 4
    const scale = this.settings.spheres.radiusScale
    const m = new THREE.Matrix4()
    const p = this.meshPos!.array as Float32Array
    const t = this.sphereTexture!.image.data as Float32Array
    for (let i = 0; i < n; i++) {
      const x = d.spheres[a + 4 * i] * (1 - f) + d.spheres[b + 4 * i] * f
      const y = d.spheres[a + 4 * i + 1] * (1 - f) + d.spheres[b + 4 * i + 1] * f
      const z = d.spheres[a + 4 * i + 2] * (1 - f) + d.spheres[b + 4 * i + 2] * f
      const r = (d.spheres[a + 4 * i + 3] * (1 - f) + d.spheres[b + 4 * i + 3] * f) * scale
      m.makeScale(r, r, r).setPosition(x, y, z)
      this.spheres!.setMatrixAt(i, m)
      t[4 * i] = p[3 * i] = x
      t[4 * i + 1] = p[3 * i + 1] = y
      t[4 * i + 2] = p[3 * i + 2] = z
      t[4 * i + 3] = r
    }
    this.spheres!.instanceMatrix.needsUpdate = true
    this.sphereTexture!.needsUpdate = true
    this.meshPos!.needsUpdate = true
    const setIndex = (g: THREE.BufferGeometry, index: Uint16Array) => {
      if (g.index?.array !== index)
        g.setIndex(new THREE.BufferAttribute(index, 1))
    }
    setIndex(this.meshA!.geometry, d.faces[k])
    setIndex(this.meshB!.geometry, d.faces[k + 1])
    ;(this.meshB!.material as THREE.MeshStandardMaterial).opacity = f
    this.meshB!.visible = this.meshA!.visible && f > 0.01
    this.wire!.set(this.edges[f < 0.5 ? k : k + 1], p)
    for (const w of this.connectWires)
      w.refresh(p)
  }

  /** The rays at frame f of the fast forward schedule (f < 0: none): the tip comes from far before
   * the first contact, stops there, goes to the last contact, stops, then leaves; each contact
   * appears when the tip reaches it and stays. */
  updateRays(f: number) {
    const sm = this.data!.manifest.sampling
    const [shafts, heads] = this.arrows
    const contacts = this.contacts!
    const on = this.cur.rays > 0.01 && f >= 0
    shafts.visible = heads.visible = on && f < sm.diffusionStart
    contacts.visible = on
    if (!on)
      return
    // the contacts stay red while the samples spread (the fast forward fades them out)
    ;(shafts.material as THREE.MeshBasicMaterial).opacity = this.cur.rays
    ;(contacts.material as THREE.MeshBasicMaterial).opacity = this.cur.rays
    const travel = sm.extent * sm.travelRatio
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const zero = new THREE.Matrix4().makeScale(0, 0, 0)
    const p = new THREE.Vector3()
    let c = 0
    this.rayPaths.forEach((r, i) => {
      const [f0, f1, f2, f3, f4, f5] = r.frames
      const ta = r.ts[0]
      const tb = r.ts[r.ts.length - 1]
      const keys: [number, number][] = [[f0, ta - travel], [f1, ta], [f2, ta], [f3, tb], [f4, tb], [f5, tb + travel]]
      if (f < f0 || f >= f5) {
        shafts.setMatrixAt(i, zero)
        heads.setMatrixAt(i, zero)
      }
      else {
        let j = 0
        while (j < keys.length - 2 && keys[j + 1][0] <= f)
          j++
        const [fa, a] = keys[j]
        const [fb, b] = keys[j + 1]
        const t = THREE.MathUtils.lerp(a, b, Math.min(1, Math.max(0, (f - fa) / Math.max(fb - fa, 1e-6))))
        q.setFromUnitVectors(up, r.dir)
        m.compose(p.copy(r.origin).addScaledVector(r.dir, t), q, new THREE.Vector3(1, 1, 1))
        shafts.setMatrixAt(i, m)
        heads.setMatrixAt(i, m)
      }
      for (const t of r.ts) {
        const at = t <= ta ? f1 : f2 + (t - ta) / Math.max(tb - ta, 1e-6) * (f3 - f2)
        contacts.setMatrixAt(c++, f >= at ? m.makeTranslation(p.copy(r.origin).addScaledVector(r.dir, t)) : zero)
      }
    })
    contacts.count = c
    shafts.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = contacts.instanceMatrix.needsUpdate = true
  }

  /** Light directions (view space) and irradiances for the sample dots (a ShaderMaterial). */
  updatePointLights() {
    const { camera, sun, ambient } = this.ps
    const inv = camera.quaternion.clone().invert()
    const dirs = this.sampleUniforms.uLightDir.value as THREE.Vector3[]
    const es = this.sampleUniforms.uLightE.value as number[]
    ;[sun, this.fill, this.rim].forEach((l, i) => {
      dirs[i].copy(l.getWorldPosition(new THREE.Vector3())).sub(l.target.getWorldPosition(new THREE.Vector3())).normalize().applyQuaternion(inv)
      es[i] = l.intensity
    })
    this.sampleUniforms.uAmbient.value = ambient.intensity * (ambient.color.r + ambient.color.g + ambient.color.b) / 3
  }

  // ---------------------------------------------------------------- render

  /** Main camera for a panel of vw × h: the focal length of the pose on the larger side (Blender's
   * sensor fit Auto), and its zoom. */
  setupCamera(vw: number, h: number) {
    const { camera } = this.ps
    const half = Math.atan(this.look.camera.sensorWidth / 2 / (this.pose?.focal ?? 45))
    const aspect = vw / h
    camera.fov = 2 * THREE.MathUtils.radToDeg(aspect >= 1 ? half : Math.atan(Math.tan(half) / aspect))
    camera.aspect = aspect
    camera.zoom = this.pose?.zoom ?? 1
    camera.updateProjectionMatrix()
  }

  /** Inset camera: from the eye of the Step 4 view (fixed to the bunny) to the focus, framing the
   * region; it does not follow the orbit camera. */
  setupInsetCamera(region: number) {
    const v = this.settings.views[this.step]
    const object = new THREE.Matrix4().compose(
      new THREE.Vector3(...v.object.location),
      new THREE.Quaternion().setFromEuler(blenderEuler(v.object.rotation)),
      new THREE.Vector3().setScalar(v.object.scale),
    )
    this.insetEye.set(...v.camera.location).applyMatrix4(object.invert())
    const content = this.ps.content
    const eye = content.localToWorld(this.insetEye.clone())
    const dist = eye.distanceTo(this.focus)
    const cam = this.insetCamera
    cam.position.copy(eye)
    cam.up.set(0, 1, 0)
    cam.lookAt(this.focus)
    cam.fov = 2 * THREE.MathUtils.radToDeg(Math.atan(region / 2 / Math.max(dist, 1e-4)))
    cam.aspect = 1
    cam.near = dist * 0.05
    cam.far = dist * 20
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
  }

  render() {
    const { renderer, scene, camera, size, content } = this.ps
    const w = size.width
    const h = size.height
    const region = this.spec.inset ? this.settings.views[this.step].inset : undefined
    const inset = !!region
    const split = this.spec.split && this.cur.mesh > 0.01
    // zoomed insets: a column of squares on the right, spheres on top, mesh below; or one square
    // of the full height
    const big = inset && !split && this.spec.bigInset
    const side = big ? Math.floor(Math.min(h, w * 0.5)) : inset ? Math.floor(Math.min(h / 2 - 4, w * 0.22)) : 0
    const mainW = inset ? w - side - 12 : w
    const regionWorld = (region?.size ?? 0) * content.scale.x
    if (region) {
      content.localToWorld(this.focus.set(...region.focus))
      this.setupInsetCamera(regionWorld)
    }
    const draw = (x: number, y: number, vw: number, vh: number, cam: THREE.Camera = camera) => {
      renderer.setViewport(x, y, vw, vh)
      renderer.setScissor(x, y, vw, vh)
      if (this.sampleUniforms.uViewportHeight) {
        // dot size in this view; smaller in the inset (individual samples, both sheets)
        this.sampleUniforms.uViewportHeight.value = vh * renderer.getPixelRatio()
        this.sampleUniforms.uSize.value = this.settings.samples.size * (cam === this.insetCamera ? INSET_DOT : 1)
      }
      // wire widths are in pixels of the view drawn
      for (const w of [this.wire, ...this.connectWires])
        w?.material.resolution.set(vw, vh)
      renderer.render(scene, cam)
    }
    const place = (f: HTMLDivElement, x: number, y: number, fw: number, fh: number) => {
      f.style.display = 'block'
      f.style.transform = `translate(${x}px, ${y}px)`
      f.style.width = `${fw}px`
      f.style.height = `${fh}px`
    }
    // panel at x of width vw, and its inset at the top (row 0) or bottom (row 1) of the column;
    // the marker: the region of the inset, as seen in the panel
    const panel = (x: number, vw: number, layers: number[], row: number) => {
      for (const cam of [camera, this.insetCamera]) {
        cam.layers.disableAll()
        for (const l of layers)
          cam.layers.enable(l)
      }
      this.setupCamera(vw, h)
      draw(x, 0, vw, h)
      this.panels.push({ x, w: vw, layers })
      if (!inset)
        return
      draw(w - side, row ? 0 : h - side, side, side, this.insetCamera)
      const p = this.focus.clone().project(camera)
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
      const q = this.focus.clone().addScaledVector(right, regionWorld).project(camera)
      const crop = Math.max(2, Math.abs(q.x - p.x) / 2 * vw)
      const cx = (p.x + 1) / 2 * vw - crop / 2
      const cy = (1 - p.y) / 2 * h - crop / 2
      place(this.frames[2 * row], x + cx, cy, crop, crop)
      place(this.frames[2 * row + 1], w - side, row ? h - side : 0, side, side)
    }
    for (const f of this.frames)
      f.style.display = 'none'
    this.panels = []
    // clear the whole canvas: the scissor still holds the last view of the previous frame
    renderer.setScissorTest(false)
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    renderer.setScissorTest(true)
    renderer.autoClear = false
    if (split) {
      panel(0, mainW / 2, [0, LAYER_SPHERES], 0)
      panel(mainW / 2, mainW / 2, [LAYER_MESH], 1)
    }
    else {
      panel(0, mainW, [0, LAYER_SPHERES], 0)
    }
    renderer.autoClear = true
    renderer.setScissorTest(false)
  }
}

let stage: PipelineStage | null = null

/** The shared stage of this window (created on first use, kept for the whole deck). */
export function pipelineStage(): PipelineStage {
  stage ??= new PipelineStage()
  if (import.meta.env.DEV)
    Object.assign(window, { __oaStage: stage, __oaClock: pipelineClock }) // for the screenshot checks
  return stage
}

// ------------------------------------------------------------------ helpers

const TET_ORANGE = new THREE.Color('#F07A3A') // tetrahedral cells, as in the paper figure
const COVER_DELTA = 0.01 // dilation δ of the run (bunny units)
// coverage timeline (0..1): the sphere of rank k (0..1, largest first) grows in from k × COVER_SPAN,
// for COVER_GROW; its samples take its colour, then shrink away (POINTS_VERT)
const COVER_SPAN = 0.75
const COVER_GROW = 0.04
const INSET_DOT = 0.5 // sample dots in the inset, × their size

/** Blender Hue/Saturation/Value (hue 0.5: unchanged) then Bright/Contrast, on linear RGB. */
function ffColor(c: Vec3, saturation: number, bright: number, contrast: number): Vec3 {
  // HSV saturation s = (max - min) / max, scaled, hue and value (max) kept
  const max = Math.max(...c)
  const s0 = max > 0 ? (max - Math.min(...c)) / max : 0
  const s = Math.min(1, s0 * saturation)
  return c.map((v) => {
    const sat = s0 > 0 ? max - (max - v) * s / s0 : v
    return Math.max(0, (1 + contrast) * sat + bright - contrast * 0.5)
  }) as Vec3
}

// the same in GLSL: uNodes = (saturation, bright, contrast)
const FF_COLOR_GLSL = /* glsl */`
uniform vec3 uNodes;
vec3 ffColor(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float s0 = mx > 0.0 ? (mx - mn) / mx : 0.0;
  float s = min(1.0, s0 * uNodes.x);
  if (s0 > 0.0) c = mx - (mx - c) * s / s0;
  return max((1.0 + uNodes.z) * c + uNodes.y - uNodes.z * 0.5, 0.0);
}`

/**
 * The k nearest spheres of each sphere (centres of iteration 0: the spheres move about one radius),
 * as sphere indices, -1 where fewer lie within 4 shown radii; rows of 256 RGBA texels.
 */
function sphereNeighbors(spheres: Float32Array, k: number, radiusScale: number): Float32Array {
  const n = spheres.length / 4
  const reach = 4 * radiusScale * 0.0052 // median radius 0.0052
  const cell = (v: number) => Math.floor(v / reach)
  const cells = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    const c = `${cell(spheres[4 * i])},${cell(spheres[4 * i + 1])},${cell(spheres[4 * i + 2])}`
    if (!cells.has(c))
      cells.set(c, [])
    cells.get(c)!.push(i)
  }
  const out = new Float32Array(Math.ceil(n * k / 4 / 256) * 256 * 4).fill(-1)
  for (let i = 0; i < n; i++) {
    const x = spheres[4 * i]
    const y = spheres[4 * i + 1]
    const z = spheres[4 * i + 2]
    const near: [number, number][] = []
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (let c = -1; c <= 1; c++) {
          for (const j of cells.get(`${cell(x) + a},${cell(y) + b},${cell(z) + c}`) ?? []) {
            const d = Math.hypot(spheres[4 * j] - x, spheres[4 * j + 1] - y, spheres[4 * j + 2] - z)
            if (j !== i && d < reach)
              near.push([d, j])
          }
        }
      }
    }
    near.sort((p, q) => p[0] - q[0])
    near.slice(0, k).forEach(([, j], m) => out[i * k + m] = j)
  }
  return out
}

/**
 * medial_balls_material_controlled of the fast forward: Attribute Col -> Hue/Saturation/Value ->
 * Bright/Contrast -> Mix (Multiply, uAoFac) with AO -> Principled. The AO: occlusion of a sphere of
 * radius r at distance d seen from a point of normal n, (n · v) (r / d)², summed over the
 * AO_NEIGHBORS nearest spheres (uSpheres: x, y, z, r per sphere; uNeighbors: sphereNeighbors).
 */
function fastForwardSpheres(material: THREE.MeshStandardMaterial, uniforms: Record<string, THREE.IUniform>) {
  const texels = AO_NEIGHBORS / 4
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vSphereP;\nvarying vec3 vSphereN;\nflat varying int vSphere;\nvoid main() {')
      .replace('#include <project_vertex>', `#include <project_vertex>
  vSphereP = (instanceMatrix * vec4(position, 1.0)).xyz;
  vSphereN = normalize(position);
  vSphere = gl_InstanceID;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform highp sampler2D uSpheres;
uniform highp sampler2D uNeighbors;
uniform float uAoFac;
varying vec3 vSphereP;
varying vec3 vSphereN;
flat varying int vSphere;
${FF_COLOR_GLSL}
void main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  float occlusion = 0.0;
  vec3 sn = normalize(vSphereN);
  for (int t = 0; t < ${texels}; t++) {
    int texel = vSphere * ${texels} + t;
    vec4 ids = texelFetch(uNeighbors, ivec2(texel % 256, texel / 256), 0);
    for (int c = 0; c < 4; c++) {
      if (ids[c] < 0.0)
        continue;
      int j = int(ids[c]);
      vec4 o = texelFetch(uSpheres, ivec2(j % 128, j / 128), 0);
      vec3 v = o.xyz - vSphereP;
      float d = max(length(v), 1e-5);
      occlusion += max(dot(sn, v / d), 0.0) * min(1.0, o.w * o.w / (d * d));
    }
  }
  float ao = clamp(1.0 - occlusion, 0.0, 1.0);
  diffuseColor.rgb = ffColor(diffuseColor.rgb) * mix(1.0, ao, uAoFac);`)
  }
  material.customProgramCacheKey = () => 'oa-ff-spheres'
  return material
}

function fadingShell(material: THREE.Material, uniforms: Record<string, THREE.IUniform>): THREE.Material {
  const compile = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uSolid;
uniform vec3 uSolidColor;
uniform float uTint;
uniform vec3 uTintColor;`)
      .replace(
        'diffuseColor.a = mix(uInteriorOpacity, 1.0, fac);',
        `diffuseColor.rgb = mix(mix(diffuseColor.rgb, uTintColor, uTint), uSolidColor, uSolid);
diffuseColor.a = mix(mix(uInteriorOpacity, 1.0, fac), 1.0, uSolid) * opacity;`,
      )
  }
  material.customProgramCacheKey = () => 'oa-fading-shell'
  return material
}

/** Mesh edges drawn as screen-space lines of a set width in pixels (LineSegments2; WebGL lines are
 * always 1 px). The end points are copied from the vertex positions shared with the mesh when the
 * positions or the edge list change. */
class ThickWire {
  readonly line: LineSegments2
  private ends: THREE.InterleavedBuffer
  private index: Uint16Array = new Uint16Array(0)

  constructor(maxEdges: number) {
    const g = new LineSegmentsGeometry()
    g.setPositions(new Float32Array(Math.max(1, maxEdges) * 6))
    this.ends = (g.attributes.instanceStart as THREE.InterleavedBufferAttribute).data
    this.line = new LineSegments2(g, new LineMaterial({ transparent: true, worldUnits: false }))
    this.line.frustumCulled = false
  }

  get material() {
    return this.line.material as LineMaterial
  }

  set(index: Uint16Array, pos: Float32Array) {
    this.index = index
    this.refresh(pos)
  }

  refresh(pos: Float32Array) {
    const a = this.ends.array as Float32Array
    const idx = this.index
    for (let e = 0; e < idx.length; e++) {
      const v = 3 * idx[e]
      a[3 * e] = pos[v]
      a[3 * e + 1] = pos[v + 1]
      a[3 * e + 2] = pos[v + 2]
    }
    this.ends.needsUpdate = true
    this.line.geometry.instanceCount = idx.length / 2
  }
}

function edgesOf(faces: Uint16Array): Uint16Array {
  const seen = new Set<number>()
  const out: number[] = []
  for (let i = 0; i < faces.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = faces[i + j]
      const b = faces[i + (j + 1) % 3]
      const key = a < b ? a * 65536 + b : b * 65536 + a
      if (!seen.has(key)) {
        seen.add(key)
        out.push(a, b)
      }
    }
  }
  return new Uint16Array(out)
}

// ------------------------------------------------------------------ shaders

// colour of the slice: RdBu (black iso-lines) of distance (bunny units) / max, HSV and
// Bright/Contrast nodes, the α line on top
const SLICE_GLSL = /* glsl */`
precision highp sampler3D;
uniform sampler3D uUdf;
uniform sampler2D uLut;
uniform float uGridMin;
uniform float uGridMax;
uniform float uMax;
uniform float uLines[32];
uniform float uAlpha;
uniform float uAlphaOn;
uniform vec3 uAlphaColor;
varying vec3 vLocal;
vec3 sliceColor() {
  vec3 uvw = (vLocal - uGridMin) / (uGridMax - uGridMin);
  float d = texture(uUdf, uvw).r;
  float u = clamp(d / uMax, 0.0, 1.0);
  vec3 col = ffColor(texture2D(uLut, vec2(u, 0.5)).rgb);
  float near = 1e3;
  for (int i = 0; i < 32; i++)
    if (uLines[i] >= 0.0) near = min(near, abs(u - uLines[i]));
  float px = fwidth(u);
  col = mix(col, vec3(0.0), 1.0 - smoothstep(0.2 * px, 0.9 * px, near)); // thin, as in the figure
  float ad = abs(d - uAlpha);
  float apx = fwidth(d);
  return mix(col, uAlphaColor, uAlphaOn * (1.0 - smoothstep(1.0 * apx, 2.5 * apx, ad)));
}`

// round dots of a fixed size in bunny units, shaded as small spheres by the three lights
// (offset_boundary_material: diffuse part of the Principled BSDF)
const POINTS_VERT = /* glsl */`
uniform float uSize;
uniform float uViewportHeight;
uniform float uProgress;
uniform float uCover;
attribute float aReveal;
attribute float aCover;
attribute vec3 aTint;
varying float vShow;
varying vec3 vTint;
varying float vTintOn;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float scale = length(modelMatrix[0].xyz);
  vShow = 1.0 - smoothstep(uProgress - 0.04, uProgress, aReveal);
  // greedy coverage: the colour of the sphere that covers the sample, then the sample goes
  float at = aCover * ${COVER_SPAN.toFixed(3)};
  vTint = aTint;
  vTintOn = uCover < 0.0 ? 0.0 : smoothstep(at, at + 0.02, uCover);
  if (uCover >= 0.0)
    vShow *= 1.0 - smoothstep(at + 0.12, at + 0.22, uCover);
  gl_PointSize = vShow * uSize * scale * projectionMatrix[1][1] * uViewportHeight * 0.5 / -mv.z;
}`

const POINTS_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uLightDir[3];
uniform float uLightE[3];
uniform float uAmbient;
varying float vShow;
varying vec3 vTint;
varying float vTintOn;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0 || vShow <= 0.0) discard;
  vec3 n = vec3(p.x, -p.y, sqrt(1.0 - r2));
  float e = uAmbient * 3.14159265;
  for (int i = 0; i < 3; i++)
    e += uLightE[i] * max(dot(n, uLightDir[i]), 0.0);
  gl_FragColor = vec4(mix(uColor, vTint, vTintOn) / 3.14159265 * e, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`
