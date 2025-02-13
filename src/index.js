// @ts-check

import { boot } from './boot';

/** @typedef {{ shortDID: string, shortHandle: string, x: number, y: number, h: number, weight: number, displayName?: string, colorRGB: number }} UserEntry */
/** @typedef {[handle: string, x: number, y: number, weight: number, displayName?: string]} UserTuple */

boot();