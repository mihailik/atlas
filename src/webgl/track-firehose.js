// @ts-check

import { firehoseWithFallback } from '../firehose/firehose-with-callback';
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

  /** @type {{ user: import('..').UserEntry, start: number, stop: number, weight: number }[]} */
  const activeFlashes = [];

  /** @type {{ from: import('..').UserEntry, to: import('..').UserEntry, start: number, stop: number, weight: number }[]} */
  const activeComets = [];

  const flash = massFlashMesh({
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
    mesh: flash,
    fallback: false
  };

  firehoseWithFallback({
    post(author, postID, text, replyTo, replyToThread, timeMsec) {
      clock.update();
      flashShortID(author, 1);
      replyTo?.shortDID ? flashShortID(replyTo.shortDID, 1) : undefined;
      replyToThread?.shortDID ? flashShortID(replyToThread.shortDID, 0.5) : undefined;
      outcome.posts++;
    },
    repost(who, whose, postID, timeMsec) {
      clock.update();
      flashShortID(who, 0.6);
      flashShortID(whose, 0.7);
      outcome.reposts++;
    },
    like(who, whose, postID, timeMsec) {
      clock.update();
      flashShortID(who, 0.1);
      flashShortID(whose, 0.4);
      outcome.likes++;
    },
    follow(who, whom, timeMsec) {
      clock.update();
      flashShortID(who, 0.1);
      flashShortID(whom, 1.5);
      outcome.follows++;
    }
  }, () => {
    outcome.fallback = true;
  });

  return outcome;

  /** @param {string} shortDID */
  function flashShortID(shortDID, weight) {
    const user = users[shortDID];
    if (user) {
      addUser(user, clock.nowSeconds, clock.nowSeconds + FADE_TIME_MSEC / 1000, weight);
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
   */
  function addUser(user, start, stop, weight) {
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

    flash.updateFlashes(activeFlashes);
  }

}