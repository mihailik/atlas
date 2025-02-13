// @ts-check

import { firehose } from 'bski';
import { breakFeedURI, shortenDID } from '../coldsky-borrow/shorten';
import { loadRelativeScriptJsonp } from '../core/load-relative-script-jsonp';

/** @param {{
 *  post?(author: string, postID: string, text: string, replyTo: { shortDID: string, postID: string } | undefined, replyToThread: { shortDID: string, postID: string } | undefined, timeMsec: number);
 *  repost?(who: string, whose: string, postID: string, timeMsec: number);
 *  like?(who: string, whose: string, postID: string, timeMsec: number);
 *  follow?(who: string, whom: string, timeMsec: number);
 *  error?(error: Error, timeMsec: number): void;
 * }} callbacks */
function firehoseDirect(callbacks) {
  let stopped = false;

  iterate();

  return { stop };

  async function iterate() {
    for await (const entry of firehose.each()) {
      if (stopped) break;
      if (entry.action === 'create') {
        let now = Date.now();
        const who = shortenDID(entry.repo);
        switch (entry.$type) {
          case 'app.bsky.feed.like':
            const likeUri = breakFeedURI(entry.subject?.uri);
            if (who && likeUri?.shortDID && likeUri?.postID)
              callbacks?.like?.(who, likeUri.shortDID, likeUri.postID, now);
            break;

          case 'app.bsky.graph.follow':
            const followWhom = shortenDID(entry.subject);
            if (who && followWhom)
              callbacks?.follow?.(who, followWhom, now);
            break;

          case 'app.bsky.feed.post':
            const postUri = breakFeedURI(entry.uri);
            if (who && postUri?.shortDID && postUri?.postID)
              callbacks?.post?.(who, postUri.shortDID, postUri.postID, undefined, undefined, now);
            break;

          case 'app.bsky.feed.repost':
            const repostUri = breakFeedURI(entry.subject?.uri);
            if (who && repostUri?.shortDID && repostUri?.postID)
              callbacks?.repost?.(who, repostUri.shortDID, repostUri.postID, now);
            break;

          default:
            break;
        }
      }
    }
  }

  function stop() {
    stopped = true;
  }
}

var firehoseJsonObj;

/** @type {typeof firehose} */
function fallbackFirehose(callbacks) {
  var waitingTimeout, stopped;
  loadAndStartFirehose();

  return { stop };

  async function loadAndStartFirehose() {
    if (!firehoseJsonObj) {
      console.log('Fallback firehose JSONP loading...');
      firehoseJsonObj = loadRelativeScriptJsonp('../atlas-db-jsonp/firehose.js');
    }

    if (typeof firehoseJsonObj?.then === 'function') {
      firehoseJsonObj = await firehoseJsonObj;
    }
    let now = Date.now();
    console.log(
      'Fallback firehose: ',
      typeof firehoseJsonObj?.length === 'number' ?
        '[' + firehoseJsonObj.length + ']' : typeof firehoseJsonObj);

    while (true) {
      let lastTimestamp = 0;
      for (const entry of firehoseJsonObj) {
        if (lastTimestamp)
          await new Promise(resolve => setTimeout(resolve, entry.timestamp - lastTimestamp));
        if (stopped) return;
        lastTimestamp = entry.timestamp;

        handleMessage(entry);
      }
    }

    function handleMessage(entry) {
      now = Date.now();
      const who = shortenDID(entry.repo);
      switch (entry.$type) {
        case 'app.bsky.feed.like':
          const likeUri = breakFeedURI(entry.subject?.uri);
          if (who && likeUri?.shortDID && likeUri?.postID)
            callbacks?.like?.(who, likeUri.shortDID, likeUri.postID, now);
          break;

        case 'app.bsky.graph.follow':
          const followWhom = shortenDID(entry.subject);
          if (who && followWhom)
            callbacks?.follow?.(who, followWhom, now);
          break;

        case 'app.bsky.feed.post':
          const postUri = breakFeedURI(entry.subject);
          if (who && postUri?.shortDID && postUri?.postID)
            callbacks?.post?.(who, postUri.shortDID, postUri.postID, undefined, undefined, now);
          break;

        case 'app.bsky.feed.repost':
          const repostUri = breakFeedURI(entry.subject?.uri);
          if (who && repostUri?.shortDID && repostUri?.postID)
            callbacks?.repost?.(who, repostUri.shortDID, repostUri.postID, now);
          break;

        default:
          break;
      }
    }


  }

  function stop() {
    stopped = true;
    clearTimeout(waitingTimeout);
  }
}

/** @type {(callbacks: Parameters<typeof firehoseDirect>[0], onFallback?: () => void) => ReturnType<typeof firehoseDirect>} */
export function firehoseWithFallback(callbacks, onFallback) {
  let websocketLikesProcessed = 0;
  /** @type {ReturnType<typeof firehoseDirect> | undefined} */
  let fallbackHose;
  /** @type {ReturnType<typeof firehoseDirect> | undefined} */
  let websocketHose = startWebsocketHose();
  let restartFirehoseOnQuietTimeout;
  const QUIET_TIMEOUT_FIREHOSE_RESTART_MSEC = 1000 * 5;

  return { stop };

  function restartFirehoseOnQuiet() {
    console.log('reconnecting to Firehose websocket due to suspicious quiet...');
    websocketHose?.stop();
    websocketHose = undefined;
    setTimeout(() => {
      websocketHose = startWebsocketHose();
    }, 50 * Math.random() + 50);
  }

  function startWebsocketHose() {
    console.log('connecting to Firehose websocket...');
    return firehoseDirect({
      ...callbacks,
      like: (who, whose, postID, timeMsec) => {
        const result = callbacks.like?.(who, whose, postID, timeMsec);
        websocketLikesProcessed++;
        clearTimeout(restartFirehoseOnQuietTimeout);
        restartFirehoseOnQuietTimeout = setTimeout(restartFirehoseOnQuiet, QUIET_TIMEOUT_FIREHOSE_RESTART_MSEC)
        return result;
      },
      error: (errorWebSocket) => {
        if (websocketLikesProcessed) {
          console.log('reconnecting to Firehose websocket due to network error...');
          websocketHose?.stop();
          websocketHose = undefined;
          setTimeout(() => {
            websocketHose = startWebsocketHose();
          }, 400 + Math.random() * 500);
        } else {
          console.log('connecting to fallback Firehose dummy data...');
          websocketHose?.stop();
          websocketHose = undefined;
          if (typeof onFallback === 'function') onFallback();
          fallbackHose = fallbackFirehose(callbacks);
        }
      }
    });
  }

  function stop() {
    websocketHose?.stop();
    fallbackHose?.stop();
  }
}