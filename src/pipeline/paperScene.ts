// three.js scene set up like the paper renders (Cycles sun + world, shadow catcher, PaperMaterial
// shell), driven by a BlenderLook (utils/blenderLook.ts). Everything under `world` is in
// Blender's Z-up frame, so object, camera and sun values are the ones of the .blend files.

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { type BlenderLook, blenderToThree, type Vec3 } from './blenderLook'
import { createPaperShellDepthMaterial, createPaperShellMaterial, createSkeletonMaterials, type PaperUniforms } from './paperMaterials'

export interface PaperScene {
  active: boolean // false: the loop keeps running but neither updates nor renders (canvas off screen)
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  world: THREE.Group
  ground: THREE.Mesh
  content: THREE.Group // object space of the mesh (location / rotation / scale of the look)
  ambient: THREE.HemisphereLight // world (sky) + bounce from the shadow catcher plane (ground)
  sun: THREE.DirectionalLight
  materials: ReturnType<typeof createSkeletonMaterials>
  shellBack: THREE.Material
  shellFront: THREE.Material
  shellDepth: THREE.Material // shadow of the shell (see createPaperShellDepthMaterial)
  paper: PaperUniforms
  shadowUniforms: { uThreshold: { value: number } }
  occluderHeight: number // object center above the shadow catcher (sets the penumbra width)
  objectCenter: THREE.Vector3 // bounding box center of the object, Blender frame (orbit pivot)
  objectMinZ: number // lowest point of the object (shadow catcher in contact mode)
  size: { width: number, height: number }
  /** called every frame before rendering */
  onFrame: Set<(now: number) => void>
  /** replaces the default single-viewport render */
  render: ((ps: PaperScene) => void) | null
  dispose: () => void
}

export function createPaperScene(container: HTMLElement): PaperScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.autoRotateSpeed = 1.2

  const world = new THREE.Group()
  world.rotation.x = -Math.PI / 2
  scene.add(world)

  const ambient = new THREE.HemisphereLight(0xFFFFFF, 0xFFFFFF, 1) // up = +Y = Blender Z
  scene.add(ambient)
  const sun = new THREE.DirectionalLight(0xFFFFFF, 1)
  sun.shadow.blurSamples = 16
  const sc = sun.shadow.camera as THREE.OrthographicCamera
  sc.left = sc.bottom = -1.8
  sc.right = sc.top = 1.8
  sc.near = 0.1
  sc.far = 20
  sun.target.position.set(0.8, 0, 0.5)
  world.add(sun, sun.target)

  const shadowUniforms = { uThreshold: { value: 0 } }
  const groundMaterial = new THREE.ShadowMaterial({ opacity: 0.9 })
  groundMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uThreshold = shadowUniforms.uThreshold
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vPlane;\nvoid main() {\nvPlane = position.xy;')
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uThreshold;\nvarying vec2 vPlane;\nvoid main() {')
      .replace(
        'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
        // compositor: ColorRamp from (threshold, alpha 0) to (1, alpha 1) on the catcher alpha;
        // faded out near the plane border, which would show as a line at the horizon
        `float catcher = opacity * ( 1.0 - getShadowMask() );
float edge = 1.0 - smoothstep( 1.4, 1.8, max( abs( vPlane.x ), abs( vPlane.y ) ) );
gl_FragColor = vec4( color, edge * clamp( ( catcher - uThreshold ) / ( 1.0 - uThreshold ), 0.0, 1.0 ) );`,
      )
  }
  // only where the shadow map reaches
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), groundMaterial)
  ground.position.set(0.8, 0, 0)
  ground.receiveShadow = true
  world.add(ground)

  const paper: PaperUniforms = {
    uColor: { value: new THREE.Color(0.25, 0.25, 0.25) },
    uBlend: { value: 0.5 },
    uRampPos: { value: new THREE.Vector4(0, 0.445, 0.655, 1) },
    uRampVal: { value: new THREE.Vector4(0.013, 0.134, 0.277, 1) },
    uInteriorOpacity: { value: 0 },
  }
  const materials = createSkeletonMaterials()
  const shellBack = createPaperShellMaterial(THREE.BackSide, paper)
  const shellFront = createPaperShellMaterial(THREE.FrontSide, paper)
  shellFront.shadowSide = THREE.DoubleSide // both layers of the shell can block a shadow ray
  const shellDepth = createPaperShellDepthMaterial(paper)
  const content = new THREE.Group()
  world.add(content)

  const size = { width: 1, height: 1 }
  const resize = () => {
    size.width = Math.max(1, container.clientWidth)
    size.height = Math.max(1, container.clientHeight)
    renderer.setSize(size.width, size.height, false)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    camera.aspect = size.width / size.height
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  resize()

  const ps: PaperScene = {
    renderer, scene, camera, controls, world, ground, content, ambient, sun, materials, shellBack, shellFront, shellDepth, paper, shadowUniforms, size,
    active: true,
    occluderHeight: 0.5,
    objectCenter: new THREE.Vector3(0.9, 0, 1),
    objectMinZ: 0,
    onFrame: new Set(),
    render: null,
    dispose() {
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh)
          o.geometry.dispose()
      })
      Object.values(materials).forEach(m => m.dispose())
      shellBack.dispose()
      shellFront.dispose()
      shellDepth.dispose()
      groundMaterial.dispose()
      sun.shadow.map?.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }

  let frame = 0
  const loop = (now: number) => {
    frame = requestAnimationFrame(loop)
    if (!ps.active)
      return
    controls.update()
    for (const f of ps.onFrame)
      f(now)
    if (ps.render)
      ps.render(ps)
    else
      renderer.render(scene, camera)
  }
  frame = requestAnimationFrame(loop)
  return ps
}

/** Blender rotation (XYZ Euler, degrees: X applied first) as a three.js Euler (same rotation). */
export function blenderEuler(deg: Vec3): THREE.Euler {
  return new THREE.Euler(...deg.map(THREE.MathUtils.degToRad) as Vec3, 'ZYX')
}

/** Direction the light of a Blender sun travels, in Blender's frame. */
export function blenderSunDirection(rotationDeg: Vec3): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyEuler(blenderEuler(rotationDeg))
}

function linear(c: Vec3, out: THREE.Color): THREE.Color {
  return out.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace)
}

/** Applies the lights, film, shadow catcher and materials of a look (cheap: no shader rebuild). */
export function applyLook(ps: PaperScene, look: BlenderLook) {
  const { renderer, sun, ambient } = ps
  renderer.toneMapping = look.film.viewTransform === 'AgX' ? THREE.AgXToneMapping : THREE.LinearToneMapping
  renderer.toneMappingExposure = look.film.exposure

  // sky of radiance L (world) above, catcher plane of radiance Lg below: a surface of normal n
  // gets π (L (1 + n.z) / 2 + Lg (1 - n.z) / 2), i.e. a HemisphereLight of intensity π
  const dir = blenderSunDirection(look.sun.rotation)
  const L = (look.world.color[0] + look.world.color[1] + look.world.color[2]) / 3 * look.world.strength
  const sunOnGround = look.sun.strength * Math.max(0, -dir.z)
  const albedo = look.shadowCatcher.color * (1 - look.shadowCatcher.transmission)
  const Lg = albedo * (sunOnGround + Math.PI * L) / Math.PI
  linear(look.world.color.map(c => c * look.world.strength) as Vec3, ambient.color)
  ambient.groundColor.setRGB(Lg, Lg, Lg, THREE.LinearSRGBColorSpace)
  ambient.intensity = Math.PI

  sun.intensity = look.sun.strength
  sun.position.copy(sun.target.position).addScaledVector(dir, -8)
  sun.castShadow = look.sun.castShadow
  const type = look.web.shadowType === 'VSM' ? THREE.VSMShadowMap : THREE.PCFShadowMap
  if (renderer.shadowMap.type !== type) {
    renderer.shadowMap.type = type
    renderer.shadowMap.needsUpdate = true
    sun.shadow.map?.dispose()
    sun.shadow.map = null
    ps.scene.traverse((o) => {
      if (o instanceof THREE.Mesh)
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true })
    })
  }
  // penumbra of a sun of angular diameter `angle` behind an occluder at height h: the shadow map
  // resolution is chosen so that the blur stays ~BLUR_TEXELS wide (wide penumbras = coarse map)
  const BLUR_TEXELS = 8
  const sc = sun.shadow.camera as THREE.OrthographicCamera
  const extent = sc.right - sc.left
  const h = look.web.penumbraHeight > 0 ? look.web.penumbraHeight : ps.occluderHeight
  const halfWidth = Math.max(1e-4, h * Math.tan(THREE.MathUtils.degToRad(look.sun.angle) / 2))
  const wanted = 2 ** Math.ceil(Math.log2(extent * BLUR_TEXELS / halfWidth))
  const mapSize = Math.min(look.web.shadowMapSize, Math.max(256, wanted))
  if (sun.shadow.mapSize.x !== mapSize) {
    sun.shadow.mapSize.set(mapSize, mapSize)
    sun.shadow.map?.dispose()
    sun.shadow.map = null
  }
  sun.shadow.radius = Math.max(1, halfWidth / (extent / mapSize))
  sun.shadow.bias = -0.0005

  // shadow catcher alpha where the sun is fully blocked: sun / (sun + world) on the ground,
  // unless set (the paper figures have lighter shadows)
  const physical = sunOnGround / (sunOnGround + Math.PI * L)
  ;(ps.ground.material as THREE.ShadowMaterial).opacity = look.shadowCatcher.opacity > 0 ? look.shadowCatcher.opacity : physical
  ps.shadowUniforms.uThreshold.value = look.shadowCatcher.threshold
  ps.ground.position.z = groundZ(ps, look)

  const p = ps.paper
  linear(look.paper.color, p.uColor.value)
  p.uBlend.value = look.paper.blend
  p.uRampPos.value.fromArray(look.paper.rampPos)
  p.uRampVal.value.fromArray(look.paper.rampVal)
  p.uInteriorOpacity.value = look.web.interiorOpacity

  const m = ps.materials
  linear(look.skeleton.edgeColor, m.edge.color)
  linear(look.skeleton.vertexColor, m.vertex.color)
  linear(look.skeleton.faceColor, m.face.color)
  m.edge.roughness = m.vertex.roughness = m.face.roughness = look.skeleton.roughness
}

function groundZ(ps: PaperScene, look: BlenderLook): number {
  return look.shadowCatcher.contact ? ps.objectMinZ : look.shadowCatcher.z
}

/** Places the mesh like the .blend object (location, rotation, uniform scale). */
export function placeObject(ps: PaperScene, look: BlenderLook, positions?: ArrayLike<number>) {
  ps.content.position.fromArray(look.object.location)
  ps.content.rotation.copy(blenderEuler(look.object.rotation))
  ps.content.scale.setScalar(look.object.scale)
  if (positions) {
    ps.content.updateMatrix()
    const box = new THREE.Box3()
    const p = new THREE.Vector3()
    for (let i = 0; i < positions.length; i += 3)
      box.expandByPoint(p.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(ps.content.matrix))
    ps.objectMinZ = box.min.z
    ps.occluderHeight = Math.max(0.05, (box.min.z + box.max.z) / 2 - groundZ(ps, look))
    box.getCenter(ps.objectCenter)
  }
}

/** Camera of the look (location, look-at), the field of view is set per panel (panelFov). */
// The mouse orbits around the object: the pivot is the point of the view ray (camera -> look-at)
// nearest to the object center, so the first image is the one of the Blender camera.
export function placeCamera(ps: PaperScene, look: BlenderLook) {
  const eye = new THREE.Vector3().fromArray(look.camera.location)
  const dir = new THREE.Vector3().fromArray(look.camera.lookAt).sub(eye).normalize()
  const t = Math.max(0.1, ps.objectCenter.clone().sub(eye).dot(dir))
  const pivot = eye.clone().addScaledVector(dir, t)
  ps.camera.position.fromArray(blenderToThree(look.camera.location))
  ps.controls.target.fromArray(blenderToThree(pivot.toArray() as Vec3))
  ps.camera.lookAt(ps.controls.target)
  ps.controls.update()
}

/**
 * Object placement for a model without paper figure: `rotation` (degrees, Blender XYZ), scale
 * 1.5 as in the figures, centered in front of the camera like them and resting on the ground.
 */
export function autoObject(positions: ArrayLike<number>, rotation: Vec3, scale = 1.5): BlenderLook['object'] {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion().setFromEuler(blenderEuler(rotation)), new THREE.Vector3(scale, scale, scale))
  const box = new THREE.Box3()
  const p = new THREE.Vector3()
  for (let i = 0; i < positions.length; i += 3)
    box.expandByPoint(p.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(m))
  const c = box.getCenter(new THREE.Vector3())
  const r = (v: number) => Math.round(v * 1000) / 1000
  return { location: [r(0.85 - c.x), r(-c.y), r(0.02 - box.min.z)], rotation, scale }
}

export function disposeChildren(group: THREE.Object3D) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh)
      o.geometry.dispose()
  })
  group.clear()
}
