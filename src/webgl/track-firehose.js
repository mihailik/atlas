// @ts-check

import { Group } from 'three';
import { firehoseWithFallback } from '../firehose/firehose-with-callback';
import { massCometMesh } from './layers/mass-comet-mesh';
import { massFlashMesh } from './layers/mass-flash-mesh';

/**
 * @param {{
 *  users: { [shortDID: string]: import('..').UserEntry },
 *  clock: ReturnType<typeof import('./clock').makeClock>
 * }} _
 */
export function trackFirehose({ users, clock }) {

  const MAX_WEIGHT = 0.1;
  const FADE_TIME_MSEC = 4000;
  const COMET_TIME_MSEC = 500;

  /** @type {{ user: import('..').UserEntry, start: number, stop: number, weight: number }[]} */
  const activeFlashes = [];

  /** @type {{ from: import('..').UserEntry, to: import('..').UserEntry, start: number, stop: number, weight: number }[]} */
  const activeComets = [];

  const flashMesh = massFlashMesh({
    clock: { now: () => clock.nowMSec },
    flashes: activeFlashes,
    get: (flash, coords) => {
      const { user } = flash;
      coords.x = user.x;
      coords.y = user.h;
      coords.z = user.y;
      coords.mass = flash.weight;
      coords.color = user.colorRGB * 256 | 0xFF;
      coords.start = flash.start;
      coords.stop = flash.stop;
    }
  });

  const cometMesh = massCometMesh({
    clock: { now: () => clock.nowMSec },
    comets: activeComets,
    get: (comet, start, stop, control) => {
      const { from, to } = comet;
      start.x = from.x;
      start.y = from.h * 1.01;
      start.z = from.y;
      start.mass = comet.weight * 0.2;
      start.color = from.colorRGB * 256 | 0xFF;
      start.time = comet.start;

      stop.x = to.x;
      stop.y = to.h * 1.1;
      stop.z = to.y;
      stop.mass = comet.weight;
      stop.color = start.color;

      control.x = (start.x + stop.x) / 2;
      control.y = (start.y + stop.y) * 0.8;
      control.z = (start.z + stop.z) / 2;
    }
  });

  const group = new Group();
  group.add(flashMesh, cometMesh);

  const unknownsLastSet = new Set();
  const unknownsTotalSet = new Set();

  const outcome = {
    posts: 0,
    reposts: 0,
    likes: 0,
    follows: 0,
    flashes: 0,
    unknowns: 0,
    unknownsTotal: 0,
    mesh: group,
    fallback: false
  };

  firehoseWithFallback({
    post(author, postID, text, replyTo, replyToThread, timeMsec) {
      clock.update();
      flashShortID(author, 1);
      if (replyTo?.shortDID) {
        flashShortID(replyTo.shortDID, 1);
        cometShortID(author, replyTo.shortDID, 0.5);
      };

      if (replyToThread?.shortDID) {
        flashShortID(replyToThread.shortDID, 0.5);
      }

      outcome.posts++;
    },
    repost(who, whose, postID, timeMsec) {
      clock.update();
      flashShortID(who, 0.6);
      flashShortID(whose, 0.7);
      cometShortID(who, whose, 0.4);
      outcome.reposts++;
    },
    like(who, whose, postID, timeMsec) {
      clock.update();
      flashShortID(who, 0.1);
      flashShortID(whose, 0.4);
      cometShortID(who, whose, 0.2);
      outcome.likes++;
    },
    follow(who, whom, timeMsec) {
      clock.update();
      flashShortID(who, 0.1);
      flashShortID(whom, 1.5);
      cometShortID(who, whom, 2);
      outcome.follows++;
    }
  }, () => {
    outcome.fallback = true;
  });

  return outcome;

  /**
   * @param {string} fromShortDID
   * @param {string} toShortDID
   * @param {number} weight
   */
  function cometShortID(fromShortDID, toShortDID, weight) {
    const fromUser = users[fromShortDID];
    const toUser = users[toShortDID];
    if (!fromUser || !toUser) return;

    addComet(
      fromUser, toUser,
      clock.nowSeconds,
      clock.nowSeconds + COMET_TIME_MSEC / 1000,
      weight);
  }

  /** @param {string} shortDID */
  function flashShortID(shortDID, weight) {
    const user = users[shortDID];
    if (user) {
      addUserFlash(user, clock.nowSeconds, clock.nowSeconds + FADE_TIME_MSEC / 1000, weight);
    } else {
      if (!outcome.unknowns) {
        unknownsLastSet.clear();
        updateFlashes();
      }

      unknownsLastSet.add(shortDID);
      unknownsTotalSet.add(shortDID);

      outcome.unknowns = unknownsLastSet.size;
      outcome.unknownsTotal = unknownsTotalSet.size;
    }
  }

  function updateFlashes() {
    outcome.flashes = 0;
    for (const flash of activeFlashes) {
      if (flash.start <= clock.nowSeconds && clock.nowSeconds <= flash.stop) {
        outcome.flashes++;
      }
    }
  }

  /**
   * @param {import('..').UserEntry} user
   * @param {number} start
   * @param {number} stop
   * @param {number} weight
   */
  function addUserFlash(user, start, stop, weight) {
    const nowSeconds = clock.nowSeconds;
    let gapIndex = -1;
    let userFlash;
    for (let i = 0; i < activeFlashes.length; i++) {
      const flash = activeFlashes[i];
      if (flash.user === user) {
        userFlash = flash;
        break;
      }

      if (nowSeconds > flash.stop) {
        gapIndex = i;
      }
    }

    if (userFlash) {
      userFlash.stop = stop;
      userFlash.weight = Math.min(MAX_WEIGHT, weight * 0.09 + userFlash.weight);
    } else {
      const normWeight = Math.min(MAX_WEIGHT, weight * 0.09 + user.weight);

      if (gapIndex >= 0) {
        const reuseFlash = activeFlashes[gapIndex];
        reuseFlash.user = user;
        reuseFlash.start = start;
        reuseFlash.stop = stop;
        reuseFlash.weight = normWeight;
      } else {
        activeFlashes.push({ user, start, stop, weight: normWeight });
      }
    }

    flashMesh.updateFlashes(activeFlashes);
  }

  /**
 * @param {import('..').UserEntry} fromUser
 * @param {import('..').UserEntry} toUser
 * @param {number} start
 * @param {number} stop
 * @param {number} weight
 */
  function addComet(fromUser, toUser, start, stop, weight) {
    const nowSeconds = clock.nowSeconds;
    let gapIndex = -1;
    for (let i = 0; i < activeComets.length; i++) {
      const co = activeComets[i];
      if (nowSeconds > co.stop) {
        gapIndex = i;
      }
    }

    const normWeight = Math.min(MAX_WEIGHT, weight * 0.09 + fromUser.weight);

    if (gapIndex >= 0) {
      const reuseComet = activeComets[gapIndex];
      reuseComet.from = fromUser;
      reuseComet.to = toUser;
      reuseComet.start = start;
      reuseComet.stop = stop;
      reuseComet.weight = normWeight;
    } else {
      activeComets.push({ from: fromUser, to: toUser, start, stop, weight: normWeight });
    }

    // flash.updateFlashes(activeFlashes);
  }

}