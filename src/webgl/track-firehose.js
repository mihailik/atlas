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
    },
    vertexShader: /* glsl */`
            float startTime = min(extra.x, extra.y);
            float endTime = max(extra.x, extra.y);
            float timeRatio = (time - startTime) / (endTime - startTime);
            float step = 0.1;
            float timeFunction = timeRatio < step ? timeRatio / step : 1.0 - (timeRatio - step) * (1.0 - step);

            //gl_Position.y += timeFunction * timeFunction * timeFunction * 0.001;
            `,
    fragmentShader: /* glsl */`
            gl_FragColor = tintColor;

            float PI = 3.1415926535897932384626433832795;

            float startTime = min(extra.x, extra.y);
            float endTime = max(extra.x, extra.y);
            float timeRatio = (time - startTime) / (endTime - startTime);
            float step = 0.05;
            float timeFunction =
              timeRatio < step ? timeRatio / step :
              timeRatio < step * 2.0 ?
                (cos((step * 2.0 - timeRatio) * step * PI) + 1.0) / 4.5 + 0.7 :
                (1.0 - (timeRatio - step * 2.0)) / 2.5 + 0.2;

            gl_FragColor = tintColor;

            gl_FragColor.a *= timeFunction;

            // gl_FragColor =
            //   timeRatio > 1000.0 ? vec4(1.0, 0.7, 1.0, tintColor.a) :
            //   timeRatio > 1.0 ? vec4(1.0, 0.0, 1.0, tintColor.a) :
            //   timeRatio > 0.0 ? vec4(0.0, 0.5, 0.5, tintColor.a) :
            //   timeRatio == 0.0 ? vec4(0.0, 0.0, 1.0, tintColor.a) :
            //   timeRatio < 0.0 ? vec4(1.0, 0.0, 0.0, tintColor.a) :
            //   vec4(1.0, 1.0, 0.0, tintColor.a);

            float diagBias = 1.0 - max(abs(vPosition.x), abs(vPosition.z));
            float diagBiasUltra = diagBias * diagBias * diagBias * diagBias;
            gl_FragColor.a *= diagBiasUltra * diagBiasUltra * diagBiasUltra;

            `
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
      unknownsLastSet.add(shortDID);
      unknownsTotalSet.add(shortDID);
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