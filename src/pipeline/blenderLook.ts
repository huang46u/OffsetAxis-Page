// Render settings of the paper figures (Cycles scenes made with BlenderToolbox, D:\Code\Paper_image),
// with the names and units of the Blender UI, so that the dev panel (⚙ button) can be compared to
// Blender one value at a time. The defaults were read from the .blend files (headless Blender dump),
// then matched to the published figures (the PNGs), which is the target: those were rendered with
// the Standard view transform (the .blend files now say AgX, Blender 4's default) and show lighter
// shadows than the .blend files give (shadowCatcher.opacity, measured on the PNGs).
//
// How the values map to three.js (see applyLook in paperScene.ts):
//  - lights: three.js shades diffuse as albedo / π × irradiance like Cycles, so the sun strength
//    (W/m²) is the DirectionalLight intensity and a uniform world of radiance L lights like an
//    AmbientLight of intensity π L;
//  - film: Cycles film exposure is a linear factor = toneMappingExposure; view transform Standard =
//    LinearToneMapping (exposure + clip), AgX = AgXToneMapping (three.js port of Blender's AgX);
//  - colors are scene-linear values, as typed in Blender's fields;
//  - shadow catcher: the alpha of a Cycles shadow catcher is the blocked fraction of the light
//    (sun / (sun + world)), then the compositor ColorRamp starting at `threshold` clears faint shadows;
//    the catcher plane still lights the scene by bounce: sky (world) + ground (lit plane) is exactly
//    a three.js HemisphereLight, the plane radiance being albedo × (1 - transmission) × irradiance / π;
//  - not reproduced: Cycles bounces / ambient occlusion, soft shadows are approximated (see `web`).

export type Vec3 = [number, number, number]
export type Vec4 = [number, number, number, number]

export interface BlenderLook {
  source: string // .blend file the defaults come from
  object: { location: Vec3, rotation: Vec3, scale: number } // the mesh (nor.ply) and skeleton objects
  camera: { location: Vec3, lookAt: Vec3, focalLength: number, sensorWidth: number }
  sun: { rotation: Vec3, strength: number, angle: number, castShadow: boolean } // angle in degrees
  world: { color: Vec3, strength: number } // Background node
  film: { viewTransform: 'Standard' | 'AgX', exposure: number }
  // plane z, compositor ramp start, MeshMaterial; opacity: alpha where the sun is fully blocked
  // (0 = physical value sun / (sun + world), ~0.93 here; the paper figures show 0.15–0.6)
  // contact: the plane is put at the lowest point of the object (the figures differ in height above
  // their plane, which makes some shadows fall far below the object); z is used when false
  shadowCatcher: { contact: boolean, z: number, threshold: number, color: number, transmission: number, opacity: number }
  paper: { color: Vec3, blend: number, rampPos: Vec4, rampVal: Vec4 } // PaperMaterial
  skeleton: {
    edgeColor: Vec3 // blueedge
    vertexColor: Vec3 // Bluevertex
    faceColor: Vec3 // Skeleton_Material
    roughness: number
    bevelDepth: number // tube radius (world units)
    vertexRadius: number // icosphere radius (world units)
  }
  // skeleton_spheres_material / surface_spheres_material: Attribute Col -> Brightness/Contrast ->
  // Mix (Multiply, fac) with itself (spheres) or with AO (partition) -> Principled
  spheres: { bright: number, contrast: number, multiply: number, roughness: number }
  partition: { points: boolean, pointRadius: number, bright: number, contrast: number, multiply: number, roughness: number }
  web: {
    shadowType: 'PCF' | 'VSM' // PCF: grainy like Cycles; VSM: smooth blur
    shadowMapSize: number
    penumbraHeight: number // occluder height turning the sun angle into a blur (0 = object center height)
    interiorOpacity: number // opacity floor of the PaperMaterial shell (0 = as in Blender)
  }
}

// chair/chair.blend (the Result figures); the other presets only change what differs
export const BLENDER_BASE: BlenderLook = {
  source: 'chair/chair.blend',
  object: { location: [1.41, -0.34, 0.1], rotation: [94.1, 7.2, -163], scale: 1.5 },
  camera: { location: [3, 0, 2], lookAt: [0, 0, 0.5], focalLength: 45, sensorWidth: 36 },
  sun: { rotation: [6, -30, -155], strength: 2, angle: 17.1887, castShadow: true }, // .blend: 5 (user: 2, softer colors)
  world: { color: [0.1, 0.1, 0.1], strength: 1 },
  film: { viewTransform: 'Standard', exposure: 1.5 },
  shadowCatcher: { contact: true, z: 0, threshold: 0.001, color: 0.8, transmission: 0.01, opacity: 0.2 }, // user: 0.2 for all objects
  paper: {
    color: [0.24829, 0.24829, 0.24829],
    blend: 0.5,
    rampPos: [0, 0.44545, 0.65455, 1],
    rampVal: [0.01313, 0.13374, 0.2771, 1],
  },
  skeleton: {
    edgeColor: [0, 0.533, 1], // user's choice (.blend: 0.031, 0.392, 0.7)
    vertexColor: [0.05, 0.192, 0.6],
    faceColor: [1, 1, 1],
    roughness: 0.5,
    bevelDepth: 0.007,
    vertexRadius: 0.009,
  },
  // plain cluster colors (the C++ pastel palette: saturation ~0.29 as in the Observation figure);
  // the partition .blend files have contrast 0.2 / multiply 0.5, which makes them more vivid
  spheres: { bright: 0, contrast: 0, multiply: 0, roughness: 0.5 },
  partition: { points: true, pointRadius: 0.01, bright: 0, contrast: 0, multiply: 0, roughness: 0.5 },
  web: { shadowType: 'VSM', shadowMapSize: 2048, penumbraHeight: 0, interiorOpacity: 0 },
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] }
export type LookOverrides = DeepPartial<BlenderLook>

// per demo: the .blend of the matching paper figure
export const DEMO_LOOKS: Record<string, LookOverrides> = {
  'demo-vase': {
    source: 'Convergence/errors_vase.ply.blend',
    object: { location: [0.58, -0.38, 0.32], rotation: [92.1, -0.8, 99], scale: 1.5 },
    sun: { angle: 33.2316, castShadow: false },
    shadowCatcher: { threshold: 0.05, transmission: 0.4 },
  },
  'edit-armadillo': {
    source: 'Interactive/armadillo_asymetrical.ply.blend',
    object: { location: [1.77, 0.34, 0.44], rotation: [109.1, 5.2, -110], scale: 1.5 },
    sun: { angle: 33.2316, castShadow: false },
    shadowCatcher: { threshold: 0.05, transmission: 0.4 },
  },
  'result-chair': {
    source: 'chair/chair.blend',
    object: { location: [1.41, -0.34, 0.1], rotation: [94.1, 7.2, -163], scale: 1.5 },
  },
  'result-bug': {
    source: 'bug/bug.blend',
    object: { location: [1.19, -0.58, 0.52], rotation: [16, 1, 52], scale: 1.5 },
  },
  'result-plane': {
    source: 'plane/plane.blend',
    object: { location: [1.2, -1.07, 0.77], rotation: [16, 1, 52], scale: 1.5 },
    sun: { angle: 33.2316 },
    shadowCatcher: { threshold: 0.05, transmission: 0.4 },
  },
  'result-octpus': {
    // no paper figure: chair settings, object placed automatically (see autoObject)
    source: 'none (chair/chair.blend settings)',
  },
  // other paper figures, for look-compare.md (<VmasLive look-id="...">)
  'figure-partition-chair': {
    source: 'PARTITION_LAMBDA/skeleton_0.2.plyparition.blend',
    object: { location: [1.49, 0.5, 0.3], rotation: [100, 3, 264], scale: 1.5 },
    sun: { angle: 33.2316 },
    film: { viewTransform: 'Standard' },
    shadowCatcher: { z: 0.2, threshold: 0.05, transmission: 0.1 },
  },
  'figure-outline-vase': {
    source: 'Overview/skeleton_20.plyoutline.blend',
    object: { location: [0.86, -0.46, 0.25], rotation: [84, 3, 105], scale: 1.5 },
    sun: { rotation: [6, -26, -227], angle: 33.2316 },
    film: { viewTransform: 'Standard' },
    shadowCatcher: { z: 0.25, threshold: 0.05, transmission: 0.1 },
  },
}

export function cloneLook(look: BlenderLook): BlenderLook {
  return structuredClone(look)
}

export function mergeLook(base: BlenderLook, ...overrides: (LookOverrides | undefined)[]): BlenderLook {
  const out = cloneLook(base) as unknown as Record<string, unknown>
  for (const o of overrides) {
    if (!o)
      continue
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object' && !Array.isArray(v))
        Object.assign(out[k] as object, structuredClone(v))
      else if (v !== undefined)
        out[k] = structuredClone(v)
    }
  }
  return out as unknown as BlenderLook
}

// looks saved from the dev panel (looks/<demo>.json), applied over the presets
const saved = import.meta.glob<LookOverrides>('../looks/*.json', { eager: true, import: 'default' })

export function savedLook(demo: string): LookOverrides | undefined {
  return saved[`../looks/${demo}.json`]
}

export function presetLook(demo: string): BlenderLook {
  return mergeLook(BLENDER_BASE, DEMO_LOOKS[demo])
}

export function lookFor(demo: string): BlenderLook {
  return mergeLook(presetLook(demo), savedLook(demo))
}

export function hasPaperFigure(demo: string): boolean {
  return !!DEMO_LOOKS[demo]?.object
}

// ------------------------------------------------------------------ conversions

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Brightness/Contrast node, then Mix (Legacy) Multiply of the result with `other` (fac). */
export function blenderColorNodes(c: number, p: { bright: number, contrast: number, multiply: number }, other?: number): number {
  const a = 1 + p.contrast
  const b = p.bright - p.contrast * 0.5
  const x = Math.max(a * c + b, 0)
  const y = other ?? x
  return x * (1 - p.multiply + p.multiply * y)
}

/** Blender world (Z-up) -> three.js (Y-up): (x, y, z) -> (x, z, -y). */
export function blenderToThree(v: Vec3): Vec3 {
  return [v[0], v[2], -v[1]]
}

export function threeToBlender(v: Vec3): Vec3 {
  return [v[0], -v[2], v[1]]
}

/** Vertical field of view (degrees) so that the square Blender frame fits inside a w × h panel. */
export function panelFov(look: BlenderLook, w: number, h: number): number {
  const half = Math.atan(look.camera.sensorWidth / 2 / look.camera.focalLength)
  const aspect = w / h
  const vHalf = aspect >= 1 ? half : Math.atan(Math.tan(half) / aspect)
  return 2 * vHalf * 180 / Math.PI
}
