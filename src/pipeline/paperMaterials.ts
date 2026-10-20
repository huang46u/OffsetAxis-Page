// three.js versions of the Blender materials of the paper figures (values: utils/blenderLook.ts).
//
// PaperMaterial (Paper_image/result/armadillo.blend):
//   Layer Weight.Facing (blend) -> Color Ramp -> Mix Shader(Transparent, Diffuse)
// i.e. a gray diffuse shell whose coverage follows a ramp of the facing value:
// nearly invisible where the surface faces the camera, opaque at silhouettes.
//
// Skeleton (Paper_image/make_skeleton.py): Principled BSDFs, blue tubes ("blueedge"), blue
// vertex spheres ("Bluevertex"), white faces ("Skeleton_Material").

import * as THREE from 'three'

export interface PaperUniforms {
  uColor: { value: THREE.Color }
  uBlend: { value: number }
  uRampPos: { value: THREE.Vector4 }
  uRampVal: { value: THREE.Vector4 }
  uInteriorOpacity: { value: number }
}

const PAPER_GLSL = /* glsl */`
uniform vec3 uColor;
uniform float uBlend;
uniform vec4 uRampPos;
uniform vec4 uRampVal;
uniform float uInteriorOpacity;
// Blender's Layer Weight node, Facing output
float layerWeightFacing(vec3 n, vec3 v, float blend) {
  float facing = abs(dot(n, v));
  if (blend != 0.5) {
    blend = clamp(blend, 0.0, 0.99999);
    blend = blend < 0.5 ? 2.0 * blend : 0.5 / (1.0 - blend);
    facing = pow(facing, blend);
  }
  return 1.0 - facing;
}
// Color Ramp node, linear interpolation between 4 stops
float paperRamp(float x) {
  vec4 P = uRampPos;
  vec4 V = uRampVal;
  if (x <= P.x) return V.x;
  if (x < P.y) return mix(V.x, V.y, (x - P.x) / max(P.y - P.x, 1e-5));
  if (x < P.z) return mix(V.y, V.z, (x - P.y) / max(P.z - P.y, 1e-5));
  if (x < P.w) return mix(V.z, V.w, (x - P.z) / max(P.w - P.z, 1e-5));
  return V.w;
}`

export function createPaperShellMaterial(side: THREE.Side, uniforms: PaperUniforms) {
  const material = new THREE.MeshLambertMaterial({ side, transparent: true, depthWrite: false })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
${PAPER_GLSL}`)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
diffuseColor.rgb = uColor;`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
float fac = paperRamp(layerWeightFacing(normalize(normal), normalize(vViewPosition), uBlend));
diffuseColor.a = mix(uInteriorOpacity, 1.0, fac);`)
  }
  return material
}

// Shadow of the shell: in Cycles, shadow rays go through the Transparent BSDF part of the mix,
// with the facing value of the shadow ray. Here each layer of the shell is kept in the shadow
// map with probability = coverage (alpha hashing); the shadow filter averages the result.
export function createPaperShellDepthMaterial(uniforms: PaperUniforms) {
  const material = new THREE.MeshDepthMaterial()
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLightNormal;')
      .replace('#include <begin_vertex>', `#include <beginnormal_vertex>
#include <defaultnormal_vertex>
vLightNormal = normalize(transformedNormal);
#include <begin_vertex>`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLightNormal;
${PAPER_GLSL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
// directional light: orthographic, the shadow rays travel along the view axis
float coverage = paperRamp(layerWeightFacing(normalize(vLightNormal), vec3(0.0, 0.0, 1.0), uBlend));
vec2 seed = gl_FragCoord.xy + (gl_FrontFacing ? vec2(0.0) : vec2(37.0, 17.0)); // independent layers
if (fract(52.9829189 * fract(dot(seed, vec2(0.06711056, 0.00583715)))) >= coverage) discard;`)
  }
  return material
}

export function createSkeletonMaterials() {
  return {
    edge: new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 }),
    vertex: new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 }),
    face: new THREE.MeshStandardMaterial({
      roughness: 0.5,
      metalness: 0,
      flatShading: true, // faces are flat shaded in the .blend files
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  }
}
