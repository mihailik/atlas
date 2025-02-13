// @ts-check

import { calcCRC32 } from '../core/crc32';
import { hslToRgb } from './hsl-to-rgb';

/** @param {string} shortDID */
export function rndUserColorer(shortDID) {
  const crc32 = calcCRC32(shortDID);
  let hue = (Math.abs(crc32) % 2000) / 2000;
  // warmer (bend the curve down a little near zero)
  const warmerHue = hue * hue;
  // mix original with warmer hue in proportion
  hue = hue * 0.7 + warmerHue * 0.3;
  const hexColor = hslToRgb(hue, 1, 0.7);
  return hexColor;
}
