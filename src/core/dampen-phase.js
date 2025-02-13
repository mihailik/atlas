// @ts-check

/** @param {number} phase */
export function dampenPhase(phase) {
  return (1 - Math.cos(phase * Math.PI)) / 2;
}
