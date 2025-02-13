// @ts-check

import { firehoseWithFallback } from '../firehose/firehose-with-callback';
import { splashSpotMesh } from './layers/splash-spot-mesh';

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
  const activeSplashes = [];

  const mesh = splashSpotMesh({
    clock: { now: () => clock.nowMSec },
    spots: activeSplashes,
    get: (splash, coords) => {
      const { user } = splash;
      coords.x = user.x;
      coords.y = user.h;
      coords.z = user.y;
      coords.mass = splash.weight;
      coords.color = user.colorRGB * 256 | 0xFF;
      coords.start = splash.start;
      coords.stop = splash.stop;
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
    mesh,
    fallback: false
  };

  firehoseWithFallback({
    post(author, postID, text, replyTo, replyToThread, timeMsec) {
      clock.update();
      splashShortID(author, 1);
      replyTo?.shortDID ? splashShortID(replyTo.shortDID, 1) : undefined;
      replyToThread?.shortDID ? splashShortID(replyToThread.shortDID, 0.5) : undefined;
      outcome.posts++;
    },
    repost(who, whose, postID, timeMsec) {
      clock.update();
      splashShortID(who, 0.6);
      splashShortID(whose, 0.7);
      outcome.reposts++;
    },
    like(who, whose, postID, timeMsec) {
      clock.update();
      splashShortID(who, 0.1);
      splashShortID(whose, 0.4);
      outcome.likes++;
    },
    follow(who, whom, timeMsec) {
      clock.update();
      splashShortID(who, 0.1);
      splashShortID(whom, 1.5);
      outcome.follows++;
    }
  }, () => {
    outcome.fallback = true;
  });

  return outcome;

  /** @param {string} shortDID */
  function splashShortID(shortDID, weight) {
    const user = users[shortDID];
    if (user) {
      addUser(user, clock.nowSeconds, clock.nowSeconds + FADE_TIME_MSEC / 1000, weight);
    } else {
      if (!outcome.unknowns)
        unknownsLastSet.clear();

      unknownsLastSet.add(shortDID);
      unknownsTotalSet.add(shortDID);

      outcome.unknowns = unknownsLastSet.size;
      outcome.unknownsTotal = unknownsTotalSet.size;
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
    let userSplash;
    for (let i = 0; i < activeSplashes.length; i++) {
      const splash = activeSplashes[i];
      if (splash.user === user) {
        userSplash = splash;
        break;
      }

      if (nowSeconds > splash.stop) {
        gapIndex = i;
      }
    }

    if (userSplash) {
      userSplash.stop = stop;
      userSplash.weight = Math.min(MAX_WEIGHT, weight * 0.09 + userSplash.weight);
    } else {
      const normWeight = Math.min(MAX_WEIGHT, weight * 0.09 + user.weight);

      if (gapIndex >= 0) {
        const reuseSplash = activeSplashes[gapIndex];
        reuseSplash.user = user;
        reuseSplash.start = start;
        reuseSplash.stop = stop;
        reuseSplash.weight = normWeight;
      } else {
        activeSplashes.push({ user, start, stop, weight: normWeight });
      }
    }

    mesh.updateSpots(activeSplashes);
  }

}