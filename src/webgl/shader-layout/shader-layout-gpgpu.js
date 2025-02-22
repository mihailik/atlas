// @ts-check

import gpuLib from 'gpu.js';

var DEFAULT_GRAVITY = 9.8;

/**
 * @template {{
 *  x?: number,
 *  y?: number,
 *  z?: number,
 *  vx?: number,
 *  vy?: number,
 *  vz?: number,
 *  mass?: number,
 * }} TParticle
 *
 * @param {{
 *  gravity?: number,
 *  particles: TParticle[],
 *  get?: (particle: TParticle, coords: { index: number, x: number, y: number, z: number, mass: number, vx: number, vy: number, vz: number }) => void
 *  set?: (particle: TParticle, coords: { index: number, x: number, y: number, z: number, vx: number, vy: number, vz: number }) => void
 * }} _ 
 */
export function shaderLayoutGPU({ gravity, particles, get, set }) {

  let [w, h] = fitDimensions(particles.length);

  const gpu = new gpuLib.GPU(); // TODO: try to request GPU?

  let calcVelocities = gpu.createKernel(nBodyVelocities, {
    output: [w, h],
    constants: { w, h, gravity: gravity || DEFAULT_GRAVITY },
    pipeline: true,
    tactic: 'precision',
  })
    .setArgumentTypes({
      positions: 'Array2D(3)',
      masses: 'Array',
      velocities: 'Array2D(3)',
      deltaTime: 'Float',
      count: 'Integer'
    })
    .setLoopMaxIterations((w + 1) * (h + 1));

  let calcPositions = gpu.createKernel(nBodyPositions, {
    output: [w, h],
    constants: { w, h },
    pipeline: true,
    tactic: 'precision'
  })
    .setArgumentTypes({
      positions: 'Array2D(3)',
      velocities: 'Array2D(3)',
      deltaTime: 'Float',
      count: 'Integer'
    });

  /** @type {Float32Array | undefined} */
  let bufPositionsIn;
  /** @type {Float32Array | undefined} */
  let bufMasses;
  /** @type {Float32Array | undefined} */
  let bufVelocities;

  /** @type {import('gpu.js').Texture | undefined} */
  let texPositionsOut;
  /** @type {import('gpu.js').Texture | undefined} */
  let texVelocitiesOut;

  updateParticles(particles);

  return {
    updateParticles,
    runLayout
  };

  function patchInput(arg, dim) {
    arg.value = arg;
    arg.size = dim;
    return arg;
  }

  /** @param {number} deltaTime */
  function runLayout(deltaTime) {
    const posArg = texPositionsOut || patchInput(/** @type {any} */(bufPositionsIn), [w, h, 3]);
    const velocitiesRes = /** @type {import('gpu.js').Texture} */(calcVelocities(
      posArg,
      patchInput(/** @type {any} */(bufMasses), [w, h]),
      texVelocitiesOut || patchInput(/** @type {any} */(bufVelocities), [w, h, 3]),
      deltaTime,
      particles.length));

    const positionsRes = /** @type {import('gpu.js').Texture} */(calcPositions(
      posArg,
      velocitiesRes,
      deltaTime,
      particles.length));

    releaseTextures();

    texVelocitiesOut = velocitiesRes;
    texPositionsOut = positionsRes;

    return applyToParticles;
  }

  function applyToParticles() {

    if (!texPositionsOut || !texVelocitiesOut) throw new Error('Textures are released already.');

    const positions = texPositionsOut.toArray();
    const velocities = texVelocitiesOut.toArray();

    const dummy = {
      index: 0,
      x: 0, y: 0, z: 0,
      mass: 0,
      vx: 0, vy: 0, vz: 0
    };

    for (let indexH = 0; indexH < h; indexH++) {
      for (let indexW = 0; indexW < w; indexW++) {
        dummy.x = dummy.y = dummy.z = 0;
        dummy.mass = 0;
        dummy.vx = dummy.vy = dummy.vz = 0;

        const index = indexH * w + indexW;
        if (index >= particles.length) break;

        const particle = particles[index];

        const posWH = positions[indexH][indexW];
        const velWH = velocities[indexH][indexW];

        if (typeof set === 'function') {
          dummy.index = index;
          dummy.x = posWH[0];
          dummy.y = posWH[1];
          dummy.z = posWH[2];
          dummy.vx = velWH[0];
          dummy.vy = velWH[1];
          dummy.vz = velWH[2];
          set(particle, dummy);
        } else {
          particle.x = posWH[0];
          particle.y = posWH[1];
          particle.z = posWH[2];
          particle.vx = velWH[0];
          particle.vy = velWH[1];
          particle.vz = velWH[2];
        }
      }
    }
  }

  /**
   * @param {Float32Array} bufPositionsIn
   * @param {Float32Array} bufMasses
   * @param {Float32Array} bufVelocities
   */
  function populateBuffers(bufPositionsIn, bufMasses, bufVelocities) {
    const dummy = {
      index: 0,
      x: 0, y: 0, z: 0,
      mass: 0,
      vx: 0, vy: 0, vz: 0
    };

    for (let i = 0; i < particles.length; i++) {
      const particle = particles[i];
      const bufIndex = i * 3;

      if (typeof get === 'function') {
        dummy.index = i;
        dummy.x = particle.x || 0;
        dummy.y = particle.y || 0;
        dummy.z = particle.z || 0;
        dummy.mass = particle.mass || 0;
        dummy.vx = particle.vx || 0;
        dummy.vy = particle.vy || 0;
        dummy.vz = particle.vz || 0;
        get(particle, dummy);

        bufPositionsIn[bufIndex] = dummy.x;
        bufPositionsIn[bufIndex + 1] = dummy.y;
        bufPositionsIn[bufIndex + 2] = dummy.z;
        bufMasses[i] = dummy.mass;
        bufVelocities[bufIndex] = dummy.vx;
        bufVelocities[bufIndex + 1] = dummy.vy;
        bufVelocities[bufIndex + 2] = dummy.vz;
      } else {
        bufPositionsIn[bufIndex] = particle.x || 0;
        bufPositionsIn[bufIndex + 1] = particle.y || 0;
        bufPositionsIn[bufIndex + 2] = particle.z || 0;
        bufMasses[i] = particle.mass || 0;
        bufVelocities[bufIndex] = particle.vx || 0;
        bufVelocities[bufIndex + 1] = particle.vy || 0;
        bufVelocities[bufIndex + 2] = particle.vz || 0;
      }
    }
  }

  /** @param {TParticle[]} newParticles */
  function updateParticles(newParticles) {
    particles = newParticles;

    const [newW, newH] = fitDimensions(newParticles.length);

    releaseTextures();

    if (!bufPositionsIn || !bufMasses || !bufVelocities || w * h < newW * newH) {
      bufPositionsIn = undefined;
      bufMasses = undefined;
      bufVelocities = undefined;

      w = newW;
      h = newH;

      bufPositionsIn = new Float32Array(w * h * 3);
      bufMasses = new Float32Array(w * h);
      bufVelocities = new Float32Array(w * h * 3);
    }

    populateBuffers(bufPositionsIn, bufMasses, bufVelocities);
  }

  function releaseTextures() {
    texPositionsOut?.delete();
    texPositionsOut = undefined;
    texVelocitiesOut?.delete();
    texVelocitiesOut = undefined;
  }

}

/** @param {number} num */
function fitDimensions(num) {
  const rt = Math.floor(Math.sqrt(num));
  if (rt * rt >= num) return [rt, rt];
  if (rt * (rt + 1) >= num) return [rt, rt + 1];
  else return [rt + 1, rt + 1];
}

/**
 * @this {import('gpu.js').IKernelFunctionThis<{ w: number, h: number, gravity }>}
 * @param {[number, number, number][][]} positions
 * @param {number[][]} masses
 * @param {[number, number, number][][]} velocities
 * @param {number} deltaTime
 * @param {number} count
 */
function nBodyVelocities(positions, masses, velocities, deltaTime, count) {

  if (this.thread.y * this.constants.w + this.thread.x > count) return [0, 0, 0];

  const xyz = positions[this.thread.y][this.thread.x];
  const x = xyz[0];
  const y = xyz[1];
  const z = xyz[2];

  const m = masses[this.thread.y][this.thread.x];
  const vXYZ = velocities[this.thread.y][this.thread.x];
  const vx = vXYZ[0];
  const vy = vXYZ[1];
  const vz = vXYZ[2];

  let totalForceX = 0;
  let totalForceY = 0;
  let totalForceZ = 0;

  let index = 0;

  for (let otherIndexY = 0; otherIndexY < this.constants.h; otherIndexY++) {
    for (let otherIndexX = 0; otherIndexX < this.constants.w; otherIndexX++) {
      index++;

      if (otherIndexX === this.thread.x && otherIndexY === this.thread.y) continue;

      const otherXYZ = positions[otherIndexY][otherIndexX];
      const otherX = otherXYZ[0];
      const otherY = otherXYZ[1];
      const otherZ = otherXYZ[2];
      const otherM = masses[otherIndexY][otherIndexX];

      const directionX = otherX - x;
      const directionY = otherY - y;
      const directionZ = otherZ - z;

      const normDiv = Math.sqrt(directionX * directionX + directionY * directionY + directionZ * directionZ);
      const normDirectionX = directionX / normDiv;
      const normDirectionY = directionY / normDiv;
      const normDirectionZ = directionZ / normDiv;

      // TODO: calc the new velocities
      const distance = Math.sqrt((x - otherX) * (x - otherX) + (y - otherY) * (y - otherY) + (z - otherZ) * (z - otherZ));
      const forceMagnitude = (this.constants.gravity * m * otherM) / (distance * distance);

      const forceX = forceMagnitude * normDirectionX;
      const forceY = forceMagnitude * normDirectionY;
      const forceZ = forceMagnitude * normDirectionZ;

      totalForceX += forceX;
      totalForceY += forceY;
      totalForceZ += forceZ;

      if (index >= count) break;
    }
  }

  const newVx = vx + totalForceX / m * deltaTime;
  const newVy = vy + totalForceY / m * deltaTime;
  const newVz = vz + totalForceZ / m * deltaTime;

  return [newVx, newVy, newVz];
}

/**
 * @this {import('gpu.js').IKernelFunctionThis<{ w: number, h: number, gravity }>}
 * @param {[number, number, number][][]} positions
 * @param {[number, number, number][][]} velocities
 * @param {number} deltaTime
 * @param {number} count
 */
function nBodyPositions(positions, velocities, deltaTime, count) {
  if (this.thread.y * this.constants.w + this.thread.x > count) return [0, 0, 0];

  const xyz = positions[this.thread.y][this.thread.x];
  const x = xyz[0];
  const y = xyz[1];
  const z = xyz[2];
  const vXYZ = velocities[this.thread.y][this.thread.x];
  const vx = vXYZ[0];
  const vy = vXYZ[1];
  const vz = vXYZ[2];

  const newX = x + vx * deltaTime;
  const newY = y + vy * deltaTime;
  const newZ = z + vz * deltaTime;

  return [newX, newY, newZ];
}
