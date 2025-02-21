// @ts-check

import gpuLib from 'gpu.js';

var DEFAULT_GRAVITY = 9.8;

/**
 * @template {{
 *  x?: number,
 *  y?: number,
 *  z?: number,
 *  mass?: number,
 * }} TParticle
 *
 * @param {{
 *  clock?: { now(): number },
 *  gravity?: number,
 *  particles: TParticle[],
 *  get: (particle: TParticle, coords: { x: number, y: number, z: number, mass: number, vx: number, vy: number, vz: number }) => void
 * }} _ 
 */
export function runBasicShader({ clock: clockArg, gravity, particles, get }) {

  let [w,h] = fitDimensions(particles.length);

  const gpu = new gpuLib.GPU(); // TODO: try to request GPU?

  let calcVelocities = gpu.createKernel(nBodyVelocities, {
    output: [w, h],
    constants: { w, h, gravity },
    pipeline: true,
    tactic: 'precision'
  })
    .setLoopMaxIterations((w + 1) * (h + 1));

  let positionsBufIn = new Float32Array(w * h * 3);
  let positionsBufOut = new Float32Array(w * h * 3);
  let massesBuf = new Float32Array(w * h);
  let velocitiesBufIn = new Float32Array(w * h * 3);
  let velocitiesBufOut = new Float32Array(w * h * 3);

  populateBuffers();

  /** @param {number} iterations */
  function runLayout(iterations) {
  }

  function populateBuffers() {
    const dummy = {
      x: 0, y: 0, z: 0,
      mass: 0,
      vx: 0, vy: 0, vz: 0
    };

    for (let i = 0; i < particles.length; i++) {
      dummy.x = dummy.y = dummy.z = 0;
      dummy.mass = 0;
      dummy.vx = dummy.vy = dummy.vz = 0;

      const particle = particles[i];
      get(particle, dummy);

      const index = i * 3;
      positionsBufIn[index] = dummy.x;
      positionsBufIn[index + 1] = dummy.y;
      positionsBufIn[index + 2] = dummy.z;
      massesBuf[i] = dummy.mass;
      velocitiesBufIn[index] = dummy.vx;
      velocitiesBufIn[index + 1] = dummy.vy;
      velocitiesBufIn[index + 2] = dummy.vz;
    }
  }

  function update(particles) {
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
 * @param {number} delta
 * @param {number} count
 */
function nBodyVelocities(positions, masses, velocities, delta, count) {

  if (this.thread.y * this.constants.w + this.thread.x > count) return [0, 0, 0];

  const [x, y, z] = positions[this.thread.y][this.thread.x];
  const m = masses[this.thread.y][this.thread.x];
  const [vx, vy, vz] = velocities[this.thread.y][this.thread.x];

  let totalForceX = 0;
  let totalForceY = 0;
  let totalForceZ = 0;

  let index = 0;

  for (let otherIndexY = 0; otherIndexY < this.constants.h; otherIndexY++) {
    for (let otherIndexX = 0; otherIndexX < this.constants.w; otherIndexX++) {
      index++;

      if (otherIndexX === this.thread.x && otherIndexY === this.thread.y) continue;

      const [otherX, otherY, otherZ] = positions[otherIndexY][otherIndexX];
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

  const newVx = vx + totalForceX / m * delta;
  const newVy = vy + totalForceY / m * delta;
  const newVz = vz + totalForceZ / m * delta;

  return [newVx, newVy, newVz];
}

/**
 * @this {import('gpu.js').IKernelFunctionThis<{ w: number, h: number, gravity }>}
 * @param {[number, number, number][][]} positions
 * @param {[number, number, number][][]} velocities
 * @param {number} delta
 * @param {number} count
 */
function nBodyPositions(positions, velocities, delta, count) {
  if (this.thread.y * this.constants.w + this.thread.x > count) return [0, 0, 0];

  const [x, y, z] = positions[this.thread.y][this.thread.x];
  const [vx, vy, vz] = velocities[this.thread.y][this.thread.x];

  const newX = x + vx * delta;
  const newY = y + vy * delta;
  const newZ = z + vz * delta;

  return [newX, newY, newZ];
}