// @ts-check

import { firehoseWithFallback } from '../firehose/firehose-with-callback';
import { dynamicShaderRenderer } from './dynamic-shader-renderer';

/**
 * @param {{
 *  users: { [shortDID: string]: import('..').UserEntry },
 *  clock: ReturnType<typeof import('./clock').makeClock>
 * }} _
 */
export function trackFirehose({ users, clock }) {

  const MAX_WEIGHT = 0.1;
  const FADE_TIME_MSEC = 4000;
  /** @type {{ [shortDID: string]: { user: import('..').UserEntry, weight: number, start: number, stop: number } }} */
  const activeUsers = {};

  const rend = dynamicShaderRenderer({
    clock,
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

            `,
    userCount: 2000
  });

  let updateUsers = false;

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
    mesh: rend.mesh,
    tickAll,
    fallback: false
  };

  firehoseWithFallback({
    post(author, postID, text, replyTo, replyToThread, timeMsec) {
      clock.update();
      addActiveUser(author, 1, timeMsec);
      replyTo?.shortDID ? addActiveUser(replyTo.shortDID, 1, timeMsec) : undefined;
      replyToThread?.shortDID ? addActiveUser(replyToThread.shortDID, 0.5, timeMsec) : undefined;
      outcome.posts++;
    },
    repost(who, whose, postID, timeMsec) {
      clock.update();
      addActiveUser(who, 0.6, timeMsec);
      addActiveUser(whose, 0.7, timeMsec);
      outcome.reposts++;
    },
    like(who, whose, postID, timeMsec) {
      clock.update();
      addActiveUser(who, 0.1, timeMsec);
      addActiveUser(whose, 0.4, timeMsec);
      outcome.likes++;
    },
    follow(who, whom, timeMsec) {
      clock.update();
      addActiveUser(who, 0.1, timeMsec);
      addActiveUser(whom, 1.5, timeMsec);
      outcome.follows++;
    }
  }, () => {
    outcome.fallback = true;
  });

  return outcome;

  /** @param {number} timePassedSec */
  function tickAll(timePassedSec) {
    const currentSec = clock.nowSeconds;
    for (const shortDID in activeUsers) {
      const ball = activeUsers[shortDID];
      if (currentSec > ball.stop) {
        delete activeUsers[shortDID];
        outcome.flashes--;
        updateUsers = true;
      }
    }

    if (updateUsers) {
      rend.updateUserSet(Object.values(activeUsers));
      updateUsers = false;
    }
  }

  /**
   * @param {string} shortDID
   * @param {number} weight
   * @param {number} _unused
   */
  function addActiveUser(shortDID, weight, _unused) {
    const nowSec = clock.nowSeconds;
    let existingUser = activeUsers[shortDID];
    if (existingUser) {
      updateUsers = true;
      existingUser.weight = Math.min(MAX_WEIGHT, weight * 0.09 + existingUser.weight);
      existingUser.stop = nowSec + FADE_TIME_MSEC / 1000;
      return 2;
    }

    const user = users[shortDID];
    if (!user) {
      if (!outcome.unknowns && unknownsLastSet.size)
        unknownsLastSet.clear();
      unknownsLastSet.add(shortDID);
      unknownsTotalSet.add(shortDID);
      outcome.unknowns = unknownsLastSet.size;
      outcome.unknownsTotal = unknownsTotalSet.size;
      return;
    }

    activeUsers[shortDID] = {
      user,
      weight: weight * 0.09,
      start: nowSec,
      stop: nowSec + FADE_TIME_MSEC / 1000
    };
    outcome.flashes++;
    updateUsers = true;
    return 1;
  }
}