// @ts-check

import { distance2D } from '../geometry/distance';

/**
* @param {number} x
* @param {number} y
* @param {{x: { min: number, max: number}, y: { min: number, max: number }}} bounds
* @param {{ x: number, y: number, h: number }} result
*/
export function mapUserCoordsToAtlas(x, y, bounds, result) {
  const xRatiod = (x - bounds.x.min) / (bounds.x.max - bounds.x.min) - 0.5;
  const yRatiod = (y - bounds.y.min) / (bounds.y.max - bounds.y.min) - 0.5;
  const r = distance2D(xRatiod, yRatiod, 0, 0);
  let h = (1 - r * r) * 0.3 - 0.265;
  result.x = xRatiod;
  result.y = -yRatiod;
  result.h = h;
}