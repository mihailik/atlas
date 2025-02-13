// @ts-check

import { rndUserColorer } from '../colors/rnd-user-colorer';
import { getUserCoordBounds } from './get-user-coord-bounds';
import { mapUserCoordsToAtlas } from './map-user-coords-to-atlas';

/**
 * @param {{
 *  users: { [shortDID: string]: import('..').UserTuple },
 *  dimensionCount: number,
 *  sleep?: () => Promise
 * }} _
 */
export async function processUsersToTiles({ users, dimensionCount, sleep }) {
  const usersBounds = getUserCoordBounds(users);

  /** @type {{ shortDID: string, usrTuple: import('..').UserTuple }[][]} */
  const tilePrototypes = [];
  for (const shortDID in users) {
    const usrTuple = users[shortDID];
    const tileX = Math.floor((usrTuple[1] - usersBounds.x.min) / (usersBounds.x.max - usersBounds.x.min) * dimensionCount);
    const tileY = Math.floor((usrTuple[2] - usersBounds.y.min) / (usersBounds.y.max - usersBounds.y.min) * dimensionCount);
    const tileIndex = tileX + tileY * dimensionCount;
    const tileBucket = tilePrototypes[tileIndex] || (tilePrototypes[tileIndex] = []);

    if (tilePrototypes.length % 10000 === 9999 && typeof sleep === 'function') await sleep();
    tileBucket.push({ shortDID, usrTuple });
  }

  let processedBuckets = 0;
  for (const tileBucket of tilePrototypes) {
    if (!tileBucket) continue;
    if (processedBuckets % 100 === 99 && typeof sleep === 'function') await sleep();

    tileBucket.sort((a, b) => b.usrTuple[3] - a.usrTuple[3]);

    processedBuckets++;
  }

  const xyhBuf = { x: 0, y: 0, h: 0 };

  /** @type {{ [shortDID: string]: import('..').UserEntry }} */
  const byShortDID = {};
  /** @type {{ [shortHandle: string]: import('..').UserEntry }} */
  const byShortHandle = {};
  /** @type {import('..').UserEntry[]} */
  const all = [];

  /** @type {import('..').UserEntry[][]} */
  const tiles = [];
  processedBuckets = 0;
  for (let iBucket = 0; iBucket < tilePrototypes.length; iBucket++) {
    const tileBucket = tilePrototypes[iBucket];
    if (!tileBucket) continue;
    if (processedBuckets % 100 === 99 && typeof sleep === 'function') await sleep();

    tiles[iBucket] = tileBucket.map(entry => {
      mapUserCoordsToAtlas(entry.usrTuple[1], entry.usrTuple[2], usersBounds, xyhBuf);
      const weightRatio = entry.usrTuple[3] && (entry.usrTuple[3] - usersBounds.weight.min) / (usersBounds.weight.max - usersBounds.weight.min);
      const weight = weightRatio ? Math.max(0.0007, 0.01 * weightRatio * Math.sqrt(weightRatio)) : 0.0005;
      const userEntry = {
        shortDID: entry.shortDID,
        shortHandle: entry.usrTuple[0],
        x: xyhBuf.x,
        y: xyhBuf.y,
        h: xyhBuf.h,
        weight,
        displayName: entry.usrTuple[4],
        colorRGB: rndUserColorer(entry.shortDID)
      };
      byShortDID[entry.shortDID] = userEntry;
      byShortHandle[userEntry.shortHandle] = userEntry;
      all.push(userEntry);
      return userEntry;
    });

    processedBuckets++;
  }

  return { byShortDID, byShortHandle, all, tiles, dimensionCount };
}