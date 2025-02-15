// @ts-check

import { WebGLRenderer } from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/Addons.js';

/**
 * @template {{
 *  x?: number,
 *  y?: number,
 *  z?: number,
 *  mass?: number,
 *  color?: number
 * }} TParticle
 *
 * @param {{
 *  gravity?: number,
 *  clock?: { now(): number },
 *  particles: TParticle[],
 *  get?: (spot: TParticle, coords: { x: number, y: number, z: number, mass: number, color: number }) => void
 * }} _ 
 */
export function forceLayout({ gravity: gravityArg, clock: clockArg, particles, get }) {
  const gravity = gravityArg || 0.001;
  const clock = clockArg || { now: () => Date.now() };

  const renderer = new WebGLRenderer({ antialias: false });
  // Create computation renderer
  const gpuCompute = new GPUComputationRenderer(1024, 1024, renderer);
 
  // Create initial state float textures
  const pos0 = gpuCompute.createTexture();
  const colorMass0 = gpuCompute.createTexture();
  const vel0 = gpuCompute.createTexture();
  // and fill in here the texture data...
 
  // Add texture variables
  const velVar = gpuCompute.addVariable('textureVelocity', /* glsl */`
uniform float time;

void main()	{

  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 tmpPos = texture2D( texturePosition, uv );
  vec3 position = tmpPos.xyz;
  vec3 velocity = texture2D( textureVelocity, uv ).xyz;

  float phase = tmpPos.w;

  phase = mod( ( phase + delta +
    length( velocity.xz ) * delta * 3. +
    max( velocity.y, 0.0 ) * delta * 6. ), 62.83 );

  gl_FragColor = vec4( position + velocity * delta * 15. , phase );

  }
    `,
    vel0);

  const posVar = gpuCompute.addVariable('texturePosition', /*glsl */`
    `,
    pos0);
 
  // Add variable dependencies
  gpuCompute.setVariableDependencies(velVar, [velVar, posVar]);
  gpuCompute.setVariableDependencies(posVar, [velVar, posVar]);
 
  // Add custom uniforms
  velVar.material.uniforms.time = { value: clock.now() };

  const result = {
    compute
  };

  return result;

  /** @param {TParticle[]} particles */
  function update(particles) {
    // TODO: recreate textures if needed
    // TODO: update textures with particle data
  }

  function compute() {
    velVar.material.uniforms.time.value = clock.now();
    gpuCompute.compute();
    // TODO: read data back from particles
  }
 
}