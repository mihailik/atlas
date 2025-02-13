// @ts-check

function atlas(invokeType) {

  const bskyService = 'https://bsky.social/xrpc/';

  /**
   * @typedef {{
   *  'app.bsky.feed.like': import ('@atproto/api').AppBskyFeedLike.Record;
   *  'app.bsky.graph.follow': import ('@atproto/api').AppBskyGraphFollow.Record;
   *  'app.bsky.feed.post': import ('@atproto/api').AppBskyFeedPost.Record;
   *  'app.bsky.feed.repost': import ('@atproto/api').AppBskyFeedRepost.Record;
   * }} FeedRecordTypeMap
   */

  /** @typedef {{ shortDID: string, shortHandle: string, x: number, y: number, h: number, weight: number, displayName?: string, colorRGB: number }} UserEntry */
  /** @typedef {[handle: string, x: number, y: number, weight: number, displayName?: string]} UserTuple */

  /**
   * @param {{
   *  users: { [shortDID: string]: UserTuple },
   *  dimensionCount: number,
   *  sleep?: () => Promise
   * }} _
   */
  async function processUsersToTiles({ users, dimensionCount, sleep }) {
    const usersBounds = getUserCoordBounds(users);

    /** @type {{ shortDID: string, usrTuple: UserTuple }[][]} */
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

    /** @type {{ [shortDID: string]: UserEntry }} */
    const byShortDID = {};
    /** @type {{ [shortHandle: string]: UserEntry }} */
    const byShortHandle = {};
    /** @type {UserEntry[]} */
    const all = [];

    /** @type {UserEntry[][]} */
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

  /**
 * @param {{
 *  testLabel: TestLabel,
 *  tiles: Iterable<TLabel>[],
 *  tileX: number, tileY: number,
 *  tileDimensionCount: number,
 *  isCloseTo: (toLabel: TLabel, testLabel: TestLabel) => number,
 *  isVisible: (label: TLabel) => boolean
 * }} _ 
 * @template TLabel
 * @template TestLabel = TLabel
 */
  function nearestLabel({
    testLabel,
    tiles,
    tileX, tileY,
    tileDimensionCount,
    isCloseTo,
    isVisible }) {
    
    const tileLabels = tiles[tileX + tileY * tileDimensionCount];

    if (tileLabels) {
      for (const otherLabel of tileLabels) {
        if (otherLabel === /** @type {*} */(testLabel)) break;
        if (!isVisible(otherLabel)) continue;

        if (isCloseTo(otherLabel, testLabel)) return otherLabel;
      }
    }

    for (let xIndex = tileX - 1; xIndex >= 0; xIndex--) {
      const testTile = tiles[xIndex + tileY * tileDimensionCount];
      if (testTile) {
        let anyLabelsInTile = false;
        for (const otherLabel of testTile) {
          if (!isVisible(otherLabel)) continue;
          anyLabelsInTile = true;
          if (isCloseTo(otherLabel, testLabel)) return otherLabel;
        }

        // if there are no labels in the tile, we must keep looking left
        if (anyLabelsInTile) break;
      }
    }

    let stopLeftAt = 0;
    for (let yIndex = tileY - 1; yIndex >=0; yIndex--) {
      for (let xIndex = tileX; xIndex > stopLeftAt; xIndex--) {
        const testTile = tiles[xIndex + yIndex * tileDimensionCount];
        if (testTile) {
          let anyLabelsInTile = false;
          for (const otherLabel of testTile) {
            if (!isVisible(otherLabel)) continue;
            anyLabelsInTile = true;
            if (isCloseTo(otherLabel, testLabel)) return otherLabel;
          }

          // if there are no labels in the tile, we must keep looking left
          if (anyLabelsInTile) {
            stopLeftAt = xIndex;
            break;
          }
        }
      }

      if (stopLeftAt === tileX) break;
    }
  }

  /** @param {{
   *  post?(author: string, postID: string, text: string, replyTo: { shortDID: string, postID: string } | undefined, replyToThread: { shortDID: string, postID: string } | undefined, timeMsec: number);
   *  repost?(who: string, whose: string, postID: string, timeMsec: number);
   *  like?(who: string, whose: string, postID: string, timeMsec: number);
   *  follow?(who: string, whom: string, timeMsec: number);
   *  error?(error: Error, timeMsec: number): void;
   * }} callbacks */
  function firehose(callbacks) {
    /** @type {typeof import('cbor-x') & {__extended42}} */
    const cbor_x = cacheRequire('cbor-x');
    /** @type {typeof import('multiformats')} */
    const multiformats = cacheRequire('multiformats');

    /** @type {typeof WebSocket} */
    const WebSocketImpl = typeof WebSocket === 'function' ? WebSocket : cacheRequire('ws');

    /** @type {typeof import('@ipld/car').CarReader} */
    const CarReader = cacheRequire('@ipld/car').CarReader;

    if (!cbor_x.__extended42) {
      cbor_x.__extended42 = true;
      cbor_x.addExtension({
        Class: multiformats.CID,
        tag: 42,
        encode: () => {
          throw new Error("cannot encode cids");
        },
        decode: (bytes) => {
          if (bytes[0] !== 0) throw new Error("invalid cid for cbor tag 42");
          return multiformats.CID.decode(bytes.subarray(1)); // ignore leading 0x00
        },
      });
    }

    let now = Date.now();

    const wsAddress = bskyService.replace(/^(http|https)\:/, 'wss:') + 'com.atproto.sync.subscribeRepos';
    const ws = new WebSocketImpl(wsAddress);
    ws.addEventListener('message', handleMessage);
    ws.addEventListener('error', error => handleError(error));

    return { stop };

    function stop() {
      ws.close();
    }

    async function handleMessage(event) {
      now = Date.now();
      if (typeof event.data?.arrayBuffer === 'function')
        return event.data.arrayBuffer().then(convertMessageBuf);
      else if (typeof event.data?.byteLength === 'number')
        return convertMessageBuf(event.data);
      // TODO: alert unusual message
    }

    async function convertMessageBuf(messageBuf) {
      const entry = /** @type {any[]} */(cbor_x.decodeMultiple(new Uint8Array(messageBuf)));
      if (!entry || entry[0]?.op !== 1) return;
      const commit = entry[1];
      if (!commit.blocks) return; // TODO: alert unusual commit
      const commitShortDID = shortenDID(commit.repo);
      if (!commitShortDID) return; // TODO: alert unusual commit

      const car = await CarReader.fromBytes(commit.blocks);

      for (const op of commit.ops) {
        const block = op.cid && await car.get(/** @type {*} */(op.cid));
        if (!block) continue; // TODO: alert unusual op

        const record = cbor_x.decode(block.bytes);
        // record.repo = commit.repo;
        // record.rev = /** @type {string} */(commit.rev);
        // record.seq = commit.seq;
        // record.since = /** @type {string} */(commit.since);
        // record.action = op.action;
        // record.cid = cid;
        // record.path = op.path;
        // record.timestamp = commit.time ? Date.parse(commit.time) : Date.now();

        if (op.action !== 'create') return; // ignore deletions for now

        switch (record.$type) {
          case 'app.bsky.feed.like': return handleLike(commitShortDID, record);
          case 'app.bsky.graph.follow': return handleFollow(commitShortDID, record);
          case 'app.bsky.feed.post': return handlePost(commitShortDID, op.path, record);
          case 'app.bsky.feed.repost': return handleRepost(commitShortDID, record);
        }
      }
    }

    /** @param {FeedRecordTypeMap['app.bsky.feed.like']} likeRecord */
    function handleLike(commitShortDID, likeRecord) {
      if (typeof callbacks.like !== 'function') return;
      const subject = breakFeedUri(likeRecord.subject?.uri);
      if (!subject) return; // TODO: alert incomplete like

      return callbacks.like(commitShortDID, subject.shortDID, subject.postID, now);
    }

    /** @param {FeedRecordTypeMap['app.bsky.graph.follow']} followRecord */
    function handleFollow(commitShortDID, followRecord) {
      if (typeof callbacks.follow !== 'function') return;
      const whom = shortenDID(followRecord.subject);
      if (!whom) return; // TODO: alert incomplete follow

      return callbacks.follow(commitShortDID, whom, now);
    }

    /** @param {FeedRecordTypeMap['app.bsky.feed.post']} postRecord */
    function handlePost(commitShortDID, postID, postRecord) {
      if (typeof callbacks.post !== 'function') return;
      const replyTo = breakFeedUri(postRecord.reply?.parent?.uri);
      const replyToThread = postRecord.reply?.root?.uri === postRecord.reply?.parent?.uri ?
        undefined :
        breakFeedUri(postRecord.reply?.root?.uri);

      return callbacks.post(commitShortDID, postID, postRecord.text, replyTo, replyToThread, now);
    }

    /** @param {FeedRecordTypeMap['app.bsky.feed.repost']} repostRecord */
    function handleRepost(commitShortDID, repostRecord) {
      if (typeof callbacks.repost !== 'function') return;
      const subject = breakFeedUri(repostRecord.subject?.uri);
      if (!subject) return; // TODO: alert incomplete repost

      return callbacks.repost(commitShortDID, subject.shortDID, subject.postID, now);
    }

    function handleError(event) {
      if (typeof callbacks.error !== 'function') return;
      callbacks.error(event, now);
    }
  }

  /** @type {(callbacks: Parameters<typeof firehose>[0], onFallback?: () => void) => ReturnType<typeof firehose>} */
  function firehoseWithFallback(callbacks, onFallback) {
    let websocketLikesProcessed = 0;
    /** @type {ReturnType<typeof firehose> | undefined} */
    let fallbackHose;
    /** @type {ReturnType<typeof firehose> | undefined} */
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
      return firehose({
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
            fallbackHose = firehoseWithFallback.fallbackFirehose(callbacks);
          }
        }
      });
    }

    function stop() {
      websocketHose?.stop();
      fallbackHose?.stop();
    }
  }

  firehoseWithFallback.fallbackFirehose = (function () {
    var firehoseJsonObj;
    return fallbackFirehose;

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
              const likeUri = breakFeedUri(entry.subject?.uri);
              if (who && likeUri?.shortDID && likeUri?.postID)
                callbacks?.like?.(who, likeUri.shortDID, likeUri.postID, now);
              break;

            case 'app.bsky.graph.follow':
              const followWhom = shortenDID(entry.subject);
              if (who && followWhom)
                callbacks?.follow?.(who, followWhom, now);
              break;

            case 'app.bsky.feed.post':
              const postUri = breakFeedUri(entry.subject?.uri);
              if (who && postUri?.shortDID && postUri?.postID)
                callbacks?.post?.(who, postUri.shortDID, postUri.postID, undefined, undefined, now);
              break;
            
            case 'app.bsky.feed.repost':
              const repostUri = breakFeedUri(entry.subject?.uri);
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
  })();

  /** @param {string} shortDID */
  function rndUserColorer(shortDID) {
    const crc32 = calcCRC32(shortDID);
    let hue = (Math.abs(crc32) % 2000) / 2000;
    // warmer (bend the curve down a little near zero)
    const warmerHue = hue * hue;
    // mix original with warmer hue in proportion
    hue = hue * 0.7 + warmerHue * 0.3;
    const hexColor = hslToRgb(hue, 1, 0.7);
    return hexColor;
  }

  var hslToRgb = (function () {

    /**
     * https://stackoverflow.com/a/9493060/140739
     * 
     * Converts an HSL color value to RGB. Conversion formula
     * adapted from https://en.wikipedia.org/wiki/HSL_color_space.
     * Assumes h, s, and l are contained in the set [0, 1] and
     * returns r, g, and b in the set [0, 255].
     *
     * @param   {number}  h       The hue
     * @param   {number}  s       The saturation
     * @param   {number}  l       The lightness
     * @return  {number}           The RGB representation
     */
    function hslToRgb(h, s, l) {
      let r, g, b;

      if (s === 0) {
        r = g = b = l; // achromatic
      } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hueToRgb(p, q, h + 1 / 3);
        g = hueToRgb(p, q, h);
        b = hueToRgb(p, q, h - 1 / 3);
      }

      return Math.round(r * 255) * 256 * 256 + Math.round(g * 255) * 256 + Math.round(b * 255);
    }

    function hueToRgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }

    return hslToRgb;
  })();

  /** @param {number=} concurrency @param {number=} cooldown */
  function createThrottledQueue(concurrency, cooldown) {

    let busy = 0;

    const result = {
      concurrency: concurrency || 3,
      cooldown: cooldown || 0,
      eventually,
      queued: /** @type {{ [key: string]: Promise & { priority: number} }} */({})
    };

    return result;

    /**
     * @param {string} arg
     * @param {(arg: string) => Promise<T>} call
     * @returns {Promise<T> & { priority: number }}
     * @template T
     */
    function eventually(arg, call) {
      let entry = result.queued[arg];
      if (entry) return entry;

      let resolve, reject;
      /** @type {*} */
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      promise._arg = arg;
      promise._call = call;
      promise._resolve = resolve;
      promise._reject = reject;
      promise.priority = 0;
      promise.then(completed, completed);
      result.queued[arg] = promise;
      setTimeout(workMore, result.cooldown);
      return /** @type {*} */(result.queued[arg]) = promise;
    }

    function completed() {
      busy--;
      setTimeout(workMore, result.cooldown);
    }

    function workMore() {
      if (busy >= result.concurrency) return;

      /** @type {*} */
      let topPriorityValue;
      for (const key in result.queued) {
        const entry = result.queued[key];
        if (!topPriorityValue || entry.priority > topPriorityValue.priority)
          topPriorityValue = entry;
      }

      if (!topPriorityValue) return;

      busy++;
      const { _arg, _call, _resolve, _reject } = topPriorityValue;
      delete result.queued[_arg];
      _call(_arg).then(_resolve, _reject);

      if (busy < result.concurrency) setTimeout(workMore, result.cooldown);
    }
  }

  /**
   * @param {string} relativePath
   * @returns {Promise<{}> | {}}
   */
  function loadRelativeScriptJsonp(relativePath) {
    const funcName = jsonpFuncName(relativePath);
    if (typeof require === 'function' && typeof require.resolve === 'function') {
      const scriptText = require('fs').readFileSync(require('path').resolve(__dirname, relativePath), 'utf8');
      var fn = eval('(function() { ' + scriptText.replace(funcName + '=' + funcName, funcName + '=jsonp') + ' \n; return ' +
        (/^store/.test(funcName) ? ' typeof ' + funcName + ' === "undefined" ? store : ' + funcName :
          funcName) +
        '; })');
      return fn();
    } else {
      return new Promise((resolve, reject) => {
        let completed = false;
        /** @type {*} */(window)[funcName] = (data) => {
          queueCleanupGlobal();
          if (completed) {
            console.log('JSONP data arrived after promise completed ', funcName, ': ', data);
            return;
          }
          completed = true;
          resolve(data);
        };
        const script = document.createElement('script');
        script.onerror = (error) => {
          if (completed) {
            console.log('JSONP script error fired after promise completed ', funcName, ': ', error);
            return;
          }
          completed = true;
          queueCleanupGlobal();
          reject(error);
        };
        script.onload = function () {
          setTimeout(() => {
            if (!completed) {
              let errorText =
                'JSONP script onload fired, but promise never completed: potentially bad JSONP response ' + funcName;
              try {
                errorText += ': ' + script.outerHTML;
              } catch (errorGettingScriptElement) {
                errorText += ', <' + 'script' + '> element not accessible';
              }
              console.log(errorText);
              completed = true;
              reject(new Error(errorText));
            }
            queueCleanupGlobal();
          }, 300);
        };
        script.src = relativePath;
        document.body.appendChild(script);

        var cleanupGlobalTimeout;
        var cleaned;
        function queueCleanupGlobal() {
          if (cleaned) return;
          clearTimeout(cleanupGlobalTimeout);
          cleanupGlobalTimeout = setTimeout(() => {
            delete window[funcName];
            if (script.parentElement) script.parentElement.removeChild(script);
            cleaned = true;
          }, 500);
        }
      });
    }
  }

  /** @param {string} path */
  function jsonpFuncName(path) {
    return /** @type {string} */(path.split(/[/\\]/g).pop())
      .replace(/\.js$/, '')
      .replace(/[^a-z0-9]/ig, '');
  }

  /** @param {string | null | undefined} did */
  function shortenDID(did) {
    return typeof did === 'string' ? did.replace(/^did\:plc\:/, '') : did;
  }

  function unwrapShortDID(shortDID) {
    return shortDID.indexOf(':') < 0 ? 'did:plc:' + shortDID : shortDID;
  }

  /** @param {string} handle */
  function shortenHandle(handle) {
    return handle && handle.replace(_shortenHandle_Regex, '');
  }
  const _shortenHandle_Regex = /\.bsky\.social$/;

  /**
   * @param {string=} uri
   */
  function breakFeedUri(uri) {
    if (!uri) return;
    const match = _breakFeedUri_Regex.exec(uri);
    if (!match || !match[3]) return;
    return { shortDID: match[2], postID: match[3] };
  }
  const _breakFeedUri_Regex = /^at\:\/\/(did:plc:)?([a-z0-9]+)\/[a-z\.]+\/?(.*)?$/;

  const mapper = (function () {

    function mapper() {
      const nodes = [];
      const edges = [];

      function like(who, whose, postID) {
      }

      function follow(who, whom) {
      }

      function post(author, postID, text, replyTo, replyToThread) {
      }
      
      function repost(who, whose, postID) {
      }
    }

    return mapper;

  })();


  const calcCRC32 = (function () {
    // CRC32 source https://stackoverflow.com/a/18639999

    /**
   * @param {string | null | undefined} str
   */
    function calcCRC32(str) {
      if (!str) return 0;
      if (!crcTable) crcTable = makeCRCTable();
      var crc = 0 ^ (-1);

      for (var i = 0; i < str.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ str.charCodeAt(i)) & 0xFF];
      }

      return (crc ^ (-1)) >>> 0;
    }

    let crcTable;
    function makeCRCTable() {
      var c;
      var crcTable = [];
      for (var n = 0; n < 256; n++) {
        c = n;
        for (var k = 0; k < 8; k++) {
          c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        crcTable[n] = c;
      }
      return crcTable;
    }

    return calcCRC32;
  })();

  function dampenPhase(phase) {
    return (1 - Math.cos(phase * Math.PI)) / 2;
  }

  /**
   * https://stackoverflow.com/a/29018745/140739
   * @param {T[]} arr
   * @param {T} el
   * @param {(el1: T, el2: T) => number | null | undefined} compare_fn 
   * @returns {number}
   * @template T
   */
  function binarySearch(arr, el, compare_fn) {
    let m = 0;
    let n = arr.length - 1;
    while (m <= n) {
      let k = (n + m) >> 1;
      let cmp = /** @type {number} */(compare_fn(el, arr[k]));
      if (cmp > 0) {
        m = k + 1;
      } else if (cmp < 0) {
        n = k - 1;
      } else {
        return k;
      }
    }
    return ~m;
  }

  /** @param {{ [shortDID: string ]: UserTuple }} users */
  function getUserCoordBounds(users) {
    const bounds = { x: { min: NaN, max: NaN }, y: { min: NaN, max: NaN }, weight: { min: NaN, max: NaN } };
    for (const shortDID in users) {
      const [shortHandle, x, y, weight] = users[shortDID];
      if (!Number.isFinite(bounds.x.min) || x < bounds.x.min) bounds.x.min = x;
      if (!Number.isFinite(bounds.x.max) || x > bounds.x.max) bounds.x.max = x;
      if (!Number.isFinite(bounds.y.min) || y < bounds.y.min) bounds.y.min = y;
      if (!Number.isFinite(bounds.y.max) || y > bounds.y.max) bounds.y.max = y;
      if (!Number.isFinite(bounds.weight.min) || weight < bounds.weight.min) bounds.weight.min = weight;
      if (!Number.isFinite(bounds.weight.max) || weight > bounds.weight.max) bounds.weight.max = weight;
    }
    return bounds;
  }

  /**
   * @param {number} x1
   * @param {number} y1
   * @param {number} x2
   * @param {number} y2
   */
  function distance2D(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * @param {number} x1
   * @param {number} y1
   * @param {number} z1
   * @param {number} x2
   * @param {number} y2
   * @param {number} z2
   */
  function distance3D(x1, y1, z1, x2, y2, z2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
 * @param {number} x
 * @param {number} y
 * @param {{x: { min: number, max: number}, y: { min: number, max: number }}} bounds
 * @param {{ x: number, y: number, h: number }} result
 */
  function mapUserCoordsToAtlas(x, y, bounds, result) {
    const xRatiod = (x - bounds.x.min) / (bounds.x.max - bounds.x.min) - 0.5;
    const yRatiod = (y - bounds.y.min) / (bounds.y.max - bounds.y.min) - 0.5;
    const r = distance2D(xRatiod, yRatiod, 0, 0);
    let h = (1 - r * r) * 0.3 - 0.265;
    result.x = xRatiod;
    result.y = -yRatiod;
    result.h = h;
  }

  /** @param {{ [shortDID: string]: [unknown, x: number, y: number, weight?: number, ...unknown[]] }} users */
  function getMassCenter(users) {
    let xTotal = 0, yTotal = 0, count = 0;
    for (const shortDID in users) {
      const usrTuple = users[shortDID];
      if (!Array.isArray(usrTuple)) continue;
      const x = usrTuple[1];
      const y = usrTuple[2];
      const weight = usrTuple[3] || 1;

      count += weight;
      xTotal += x * weight;
      yTotal += y * weight;
    }
    return { x: xTotal / count, y: yTotal / count };
  }

  /**
 * @param {string} searchText
 * @param {UserEntry[]} userList
 */
  function findUserMatches(searchText, userList) {
    if (!searchText) return;

    const mushMatch = new RegExp([...searchText.replace(/[^a-z0-9]/gi, '')].join('.*'), 'i');
    const mushMatchLead = new RegExp('^' + [...searchText.replace(/[^a-z0-9]/gi, '')].join('.*'), 'i');

    const searchWordRegExp = new RegExp(
      searchText.split(/\s+/)
        // sort longer words match first
        .sort((w1, w2) => w2.length - w1.length || (w1 > w2 ? 1 : w1 < w2 ? -1 : 0))
        // generate a regexp out of word
        .map(word => '(' + word.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&') + ')')
        .join('|'),
      'gi');

    /** @type {{ user: UserEntry, rank: number }[]} */
    const matches = [];
    for (const user of userList) {
      let rank = 0;

      if (user.displayName) {
        searchWordRegExp.lastIndex = 0;
        while (true) {
          const match = searchWordRegExp.exec(user.displayName);
          if (!match) break;
          rank += (match[0].length / user.displayName.length) * 20;
          if (match.index === 0) rank += 30;
        }

        if (mushMatch.test(user.displayName)) rank += 3;
        if (mushMatchLead.test(user.displayName)) rank += 5;
      }

      searchWordRegExp.lastIndex = 0;
      while (true) {
        const match = searchWordRegExp.exec(user.shortHandle);
        if (!match) break;
        rank += (match[0].length / user.shortHandle.length) * 30;
        if (match.index === 0) rank += 40;
      }

      if (mushMatch.test(user.shortHandle)) rank += 3;
      if (mushMatchLead.test(user.shortHandle)) rank += 5;

      if (rank) matches.push({ user, rank });
    }

    matches.sort((m1, m2) => m2.rank - m1.rank);
    return matches?.length ? matches : undefined;
  }

  function makeClock() {
    const clock = {
      worldStartTime: Date.now(),
      nowMSec: 0,
      nowSeconds: 0,
      update
    };

    return clock;

    function update() {
      clock.nowSeconds =
        (clock.nowMSec = Date.now() - clock.worldStartTime)
        / 1000;
    }
  }

  async function runBrowser(invokeType) {
    const bootStages = boot();
    await bootStages.waitForRunBrowserNext;

    /** @type {import('@atproto/api')} */
    const atproto = /** @type {*} */(atlas).imports['@atproto/api'];
    /** @type {typeof import('three')} */
    const THREE = /** @type {*} */(atlas).imports['three'];
    const Stats = /** @type {*} */(atlas).imports['three/addons/libs/stats.module.js'];
    const OrbitControls = /** @type {*} */(atlas).imports['three/addons/controls/OrbitControls.js'];
    const MapControls = /** @type {*} */(atlas).imports['three/addons/controls/MapControls.js'];
    /** @type {typeof import('troika-three-text')} */
    const troika_three_text = /** @type {*} */(atlas).imports['troika-three-text'];

    runWebglGalaxy(bootStages.waitForUsersLoaded);

    function boot() {
      const INIT_UI_FADE_MSEC = 2000;
        // @ts-ignore
      const waitForRunBrowserNext = new Promise(resolve => runBrowser = resolve);

      /** @type {Promise<{ [shortDID: string]: UserTuple}>} */
      let waitForUsersLoaded = new Promise((resolve, reject) =>
        // @ts-ignore
        typeof hot !== 'undefined' ? resolve(hot) :
        // @ts-ignore
        hot = value =>
          value.message ? reject(value) : resolve(value))
        .catch(() => {
          return new Promise((resolve, reject) => {
            const loadAbsoluteScript = document.createElement('script');
            loadAbsoluteScript.onerror = reject;
            // @ts-ignore
            hot = resolve;
            loadAbsoluteScript.src = 'https://mihailik.github.io/atlas-db-jsonp/users/hot.js';
            loadAbsoluteScript.defer = true;
            loadAbsoluteScript.async = true;
            document.body.appendChild(loadAbsoluteScript);
          });
        });

      (async () => {
        let timedout = await Promise.race([
          Promise.all([waitForUsersLoaded, waitForRunBrowserNext]),
          new Promise(resolve => setTimeout(() => resolve('timedout'), 600))]);

        if (timedout === 'timedout') {
          const initUI = createInitUI();
          await waitForUsersLoaded;
          await waitForRunBrowserNext;
          initUI.style.opacity = '0';
          initUI.style.pointerEvents = 'none';
          setTimeout(() => {
            initUI.remove();
          }, INIT_UI_FADE_MSEC * 1.5);
        }
      })();

      return { waitForUsersLoaded, waitForRunBrowserNext };

      function createInitUI() {
        elem('style', {
          parent: document.head,
          innerHTML: `
        .atlas-init {
          position: fixed;
          bottom: 0; left: 0; width: 100%;
          text-align: center;
          opacity: 0;
          transition: opacity ${INIT_UI_FADE_MSEC}ms;
          z-index: 100;
        }
      `});

        const initUI = elem('div', {
          className: 'atlas-init',
          parent: document.body,
          opacity: '0',
          children: [
            elem('h1', { textContent: 'Loading...' }),
            elem('p', { textContent: 'Application code and user accounts base is loading.' })
          ]
        });

        setTimeout(() => initUI.style.opacity = '1', 1);

        return initUI;
      }
    }

    async function runWebglGalaxy(loadUsersPromise) {
      constructStateAndRun();

      async function constructStateAndRun() {
        /** @type {{ [shortDID: string]: UserTuple }} */
        const rawUsers = await loadUsersPromise;
        const startProcessToTiles = Date.now();
        const usersAndTiles = await processUsersToTiles({ users: rawUsers, dimensionCount: 48, sleep: () => new Promise(resolve => setTimeout(resolve, 1)) });
        console.log('Processed users to tiles in ', Date.now() - startProcessToTiles, ' msec');
        const clock = makeClock();

        const {
          scene,
          camera,
          renderer,
          stats,
        } = setupScene(usersAndTiles.all, clock);

        const domElements = createDOMLayout({
          canvas3D: renderer.domElement,
          statsElem: stats.domElement,
          userCount: usersAndTiles.all.length
        });

        const orbit = setupOrbitControls({ camera, host: renderer.domElement, clock });

        // domElements.rightStatus.addEventListener('click', () => {
        //   orbit.flipControlType();
        // });

        const searchUI = searchUIController({
          titleBarElem: domElements.title,
          onClose: () => {
            domElements.subtitleArea.innerHTML = '';
          },
          onSearchText: (searchText) => {
            const matches = findUserMatches(searchText, usersAndTiles.all);
            if (!matches?.length) searchReportNoMatches(domElements.subtitleArea);
            else searchReportMatches({
              matches,
              subtitleArea: domElements.subtitleArea,
              onChipClick: (shortDID, userChipElem) =>
                focusAndHighlightUser({
                  shortDID,
                  users: usersAndTiles.byShortDID,
                  scene,
                  camera,
                  moveAndPauseRotation: orbit.moveAndPauseRotation
                })
            });
          }
        });

        if (location.hash?.length > 3) {
          const hasCommaParts = location.hash.replace(/^#/, '').split(',');
          if (hasCommaParts.length === 3) {
            const [cameraX, cameraY, cameraZ] = hasCommaParts.map(parseFloat);
            camera.position.set(cameraX, cameraY, cameraZ);
          }
        }

        handleWindowResizes(camera, renderer);

        trackTouchWithCallback({
          touchElement: document.body,
          uxElements: [domElements.titleBar, domElements.subtitleArea, domElements.bottomStatusLine],
          renderElements: [renderer.domElement, domElements.root],
          touchCallback: (xy) => {
            // console.log('touch ', xy);
          }
        });

        const firehoseTrackingRenderer = trackFirehose({ users: usersAndTiles.byShortDID, clock });
        scene.add(firehoseTrackingRenderer.mesh);

        const geoLayer = renderGeoLabels({
          users: usersAndTiles.all,
          tiles: usersAndTiles.tiles,
          tileDimensionCount: usersAndTiles.dimensionCount,
          clock
        });
        scene.add(geoLayer.layerGroup);

        startAnimation();

        function startAnimation() {

          requestAnimationFrame(continueAnimating);

          function continueAnimating() {
            requestAnimationFrame(continueAnimating);
            renderFrame();
          }

          let lastCameraUpdate;
          /** @type {THREE.Vector3} */
          let lastCameraPos;
          let lastRender;
          let lastBottomStatsUpdate;
          let lastVibeCameraPos;
          let lastVibeTime;
          function renderFrame() {
            clock.update();

            geoLayer.updateWithCamera(camera);

            let rareMoved = false;
            if (!lastCameraPos || !(clock.nowMSec < lastCameraUpdate + 200)) {
              lastCameraUpdate = clock.nowMSec;
              if (!lastCameraPos) lastCameraPos = new THREE.Vector3(NaN, NaN, NaN);

              const dist = camera.position.distanceTo(lastCameraPos);

              if (!(dist < 0.0001)) {
                rareMoved = true;
              }
            }

            if (!lastVibeCameraPos) {
              lastVibeCameraPos = camera.position.clone();
              lastVibeTime = clock.nowMSec;
            } else {
              const vibeDist = camera.position.distanceTo(lastVibeCameraPos);
              if (Number.isFinite(vibeDist) && vibeDist > 0.1 && (clock.nowMSec - lastVibeTime) > 200) {
                lastVibeCameraPos.copy(camera.position);
                lastVibeTime = clock.nowMSec;
                try {
                  if (typeof navigator.vibrate === 'function') {
                    navigator.vibrate(30);
                  }
                } catch (bibErr) { }
              }

            }

            stats.begin();
            const delta = lastRender ? clock.nowMSec - lastRender : 0;
            lastRender = clock.nowMSec;
            orbit.controls.update(Math.min(delta / 1000, 0.2));
            firehoseTrackingRenderer.tickAll(delta / 1000);

            renderer.render(scene, camera);
            stats.end();

            if (rareMoved) {
              lastCameraPos.copy(camera.position);
              domElements.status.update(
                camera,
                orbit.rotating,
                firehoseTrackingRenderer.fallback
              );

              const updatedHash =
                '#' +
                camera.position.x.toFixed(2) + ',' + camera.position.y.toFixed(2) + ',' + camera.position.z.toFixed(2) +
                '';

              try {
                history.replaceState(null, '', updatedHash);
              } catch (_error) {
              }
            }

            if (!(clock.nowMSec - lastBottomStatsUpdate < 1000) && domElements.bottomStatusLine) {
              lastBottomStatsUpdate = clock.nowMSec;
              domElements.bottomStatusLine.update(firehoseTrackingRenderer, geoLayer);
            }
          }
        }
      }

      /**
       * @param {UserEntry[]} users
       * @param {ReturnType<typeof makeClock>} clock
       */
      function setupScene(users, clock) {
        const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.00001, 10000);
        camera.position.x = 0.18;
        camera.position.y = 0.49;
        camera.position.z = 0.88;

        const scene = new THREE.Scene();

        const dirLight1 = new THREE.DirectionalLight(0xffffff, 7);
        dirLight1.position.set(0.5, 1, -0.5);
        scene.add(dirLight1);

        const dirLight2 = new THREE.DirectionalLight(0xffffff, 2);
        dirLight2.position.set(-0.5, -0.5, 0.5);
        scene.add(dirLight2);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        scene.add(ambientLight);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);

        const stats = new Stats();

        const farUsersMesh = massShaderRenderer({ clock, users: users });
        scene.add(farUsersMesh);

        return {
          scene,
          camera,
          lights: { dirLight1, dirLight2, ambientLight },
          renderer,
          stats
        };
      }


      /**
       * @param {{
       *  camera: THREE.PerspectiveCamera,
       *  host: HTMLElement,
       *  clock: ReturnType<typeof makeClock>
       * }} _
       */
      function setupOrbitControls({ camera, host, clock }) {
        const STEADY_ROTATION_SPEED = 0.2;

        let usedControlType = OrbitControls;
        const possibleControlTypes = [OrbitControls, MapControls];

        let controls = initControls(usedControlType);

        const outcome = {
          controls,
          rotating: !!controls.autoRotate,
          pauseRotation,
          waitAndResumeRotation,
          moveAndPauseRotation,
          flipControlType
        };

        return outcome;

        var changingRotationInterval;

        /**
         * @param {{
         *  new (camera: THREE.PerspectiveCamera, host: HTMLElement): {
         *    target: THREE.Vector3;
         *    addEventListener(event: 'start' | 'end', callback: Function);
         *    maxDistance: number;
         *    enableDamping: boolean;
         *    autoRotate: boolean;
         *    autoRotateSpeed: number;
         *    listenToKeyEvents(element);
         *    saveState(): void;
         *    reset(): void;
         *    dispose(): void;
         *    update(deltaTime?: number): void;
         *  } }} OrbitControls 
         * @returns 
         */
        function initControls(OrbitControls) {
          let controls = new OrbitControls(camera, host);
          controls.addEventListener('start', function () {
            pauseRotation();
          });

          // restart autorotate after the last interaction & an idle time has passed
          controls.addEventListener('end', function () {
            waitAndResumeRotation();
          });

          controls.maxDistance = 40 * 1000;
          controls.enableDamping = true;
          controls.autoRotate = true;
          controls.autoRotateSpeed = STEADY_ROTATION_SPEED;
          controls.listenToKeyEvents(createKeyEventProxy(window));
          return controls;


          /** @param {HTMLElement | Window} originalElement */
          function createKeyEventProxy(originalElement) {
            const keydownCallbacks = [];
            return {
              addEventListener: overrideAddEventListener,
              removeEventListener: overrideRemoveEventListener,
            };

            /** @param {Event} event */
            function handleKeydown(event) {
              const target = /** @type {HTMLElement} */(event.target);
              if (/input/i.test(target?.tagName)) return;
              let result;
              for (const callback of keydownCallbacks) {
                result = callback(event);
              }
              return result;
            }

            function overrideAddEventListener(event, callback) {
              if (event === 'keydown') {
                if (keydownCallbacks.length === 0)
                  originalElement.addEventListener('keydown', handleKeydown);
                keydownCallbacks.push(callback);
              } else {
                host.addEventListener(event, callback);
              }
            }

            function overrideRemoveEventListener(event, callback) {
              if (event === 'keydown') {
                keydownCallbacks.splice(keydownCallbacks.indexOf(callback), 1);
                if (keydownCallbacks.length === 0)
                  originalElement.removeEventListener('keydown', handleKeydown);
              } else {
                host.removeEventListener(event, callback);
              }
            }

          }
        }

        function flipControlType() {
          controls.saveState();
          const state = {};
          for (const key in controls) {
            if (key.charAt(key.length - 1) === '0') {
              state[key] = controls[key];
            }
          }
          controls.dispose();
          const nextControlType = possibleControlTypes[(possibleControlTypes.indexOf(usedControlType) + 1) % possibleControlTypes.length];
          controls = initControls(nextControlType);
          outcome.rotating = controls.autoRotate;
          for (const key in state) {
            controls[key] = state[key];
          }
          controls.reset();
        }

        function pauseRotation() {
          if (controls.autoRotate) controls.autoRotate = false;

          outcome.rotating = false;
          clearInterval(changingRotationInterval);
        }

        function waitAndResumeRotation(resumeAfterWait) {
          const WAIT_BEFORE_RESUMING_MSEC = 10000;
          const SPEED_UP_WITHIN_MSEC = 10000;

          if (!resumeAfterWait) resumeAfterWait = WAIT_BEFORE_RESUMING_MSEC;

          clearInterval(changingRotationInterval);
          const startResumingRotation = clock.nowMSec;
          changingRotationInterval = setInterval(continueResumingRotation, 100);


          function continueResumingRotation() {
            const passedTime = clock.nowMSec - startResumingRotation;
            if (passedTime < resumeAfterWait) return;
            if (passedTime > resumeAfterWait + SPEED_UP_WITHIN_MSEC) {
              controls.autoRotateSpeed = STEADY_ROTATION_SPEED;
              controls.autoRotate = true;
              outcome.rotating = true;
              clearInterval(changingRotationInterval);
              return;
            }

            const phase = (passedTime - resumeAfterWait) / SPEED_UP_WITHIN_MSEC;
            controls.autoRotate = true;
            outcome.rotating = true;
            controls.autoRotateSpeed = 0.2 * dampenPhase(phase);
          }
        }

        /**
         * @param {{x: number, y: number, h: number }} xyh
         * @param {{x: number, y: number, h: number }} towardsXYH
         */
        function moveAndPauseRotation(xyh, towardsXYH) {
          const MOVE_WITHIN_MSEC = 6000;
          const WAIT_AFTER_MOVEMENT_BEFORE_RESUMING_ROTATION_MSEC = 30000;
          const MIDDLE_AT_PHASE = 0.6;
          const RAISE_MIDDLE_WITH = 0.25;

          pauseRotation();
          const startMoving = clock.nowMSec;
          const startCameraPosition = camera.position.clone();
          const startCameraTarget = controls.target.clone();

          const r = distance2D(xyh.x, xyh.y, 0, 0);
          const angle = Math.atan2(xyh.y, xyh.x);
          const xMiddle = (r + 0.6) * Math.cos(angle);
          const yMiddle = (r + 0.6) * Math.sin(angle);
          const hMiddle = xyh.h + RAISE_MIDDLE_WITH;

          changingRotationInterval = setInterval(continueMoving, 10);

          function continueMoving() {

            const passedTime = clock.nowMSec - startMoving;
            if (passedTime > MOVE_WITHIN_MSEC) {
              clearInterval(changingRotationInterval);
              camera.position.set(xyh.x, xyh.h, xyh.y);
              controls.target.set(towardsXYH.x, towardsXYH.h, towardsXYH.y);
              waitAndResumeRotation(WAIT_AFTER_MOVEMENT_BEFORE_RESUMING_ROTATION_MSEC);
              return;
            }

            const phase = passedTime / MOVE_WITHIN_MSEC;
            controls.target.set(
              startCameraTarget.x + (towardsXYH.x - startCameraTarget.x) * phase,
              startCameraTarget.y + (towardsXYH.h - startCameraTarget.y) * phase,
              startCameraTarget.z + (towardsXYH.y - startCameraTarget.z) * phase);

            if (passedTime < MOVE_WITHIN_MSEC * MIDDLE_AT_PHASE) {
              const dampenedPhase = dampenPhase(phase / MIDDLE_AT_PHASE);
              camera.position.set(
                startCameraPosition.x + (xMiddle - startCameraPosition.x) * dampenedPhase,
                startCameraPosition.y + (hMiddle - startCameraPosition.y) * dampenedPhase,
                startCameraPosition.z + (yMiddle - startCameraPosition.z) * dampenedPhase);
            } else {
              const dampenedPhase = dampenPhase((phase - MIDDLE_AT_PHASE) / (1 - MIDDLE_AT_PHASE));
              camera.position.set(
                xMiddle + (xyh.x - xMiddle) * dampenedPhase,
                hMiddle + (xyh.h - hMiddle) * dampenedPhase,
                yMiddle + (xyh.y - yMiddle) * dampenedPhase);
            }
          }
        }
      }

      /**
       * @param {{
       *  users: { [shortDID: string]: UserEntry },
       *  clock: ReturnType<typeof makeClock>
       * }} _
       */
      function trackFirehose({ users, clock }) {

        const MAX_WEIGHT = 0.1;
        const FADE_TIME_MSEC = 4000;
        /** @type {{ [shortDID: string]: { user: UserEntry, weight: number, start: number, stop: number } }} */
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

      /**
       * @param {{
       *  canvas3D: HTMLElement,
       *  statsElem: HTMLElement,
       *  userCount: number,
       * }} _
       */
      function createDOMLayout({ canvas3D, statsElem, userCount }) {
        let title, titleBar, subtitleArea, rightStatus, searchMode, bottomStatusLine;
        const root = elem('div', {
          parent: document.body,
          style: `
          position: fixed; left: 0; top: 0; width: 100%; height: 100%;
          display: grid; grid-template-rows: auto auto 1fr auto; grid-template-columns: 1fr;
          `,
          children: [
            canvas3D,
            titleBar = elem('div', {
              style: `
              background: rgba(0,0,0,0.5); color: gold;
              display: grid; grid-template-rows: auto; grid-template-columns: auto 1fr auto;
              z-index: 10;
              max-height: 5em;`,
              children: [
                statsElem,
                title = elem('h3', {
                  style: `
                  text-align: center;
                  font-weight: 100;
                  align-self: center;
                  margin: 0.1em;
                  `,
                  children: [
                    elem('span', 'display: inline-block; width: 1em;'),
                    elem('span', { textContent: 'Atlas 3D' }),
                    elem('span', {
                      className: 'search-icon',
                      innerHTML: `<style>
                        .search-icon {
                          display: inline-block;
                          transform: rotate(314deg);
                          cursor: pointer;
                        }
                        .search-icon:before {
                          content: '';
                          display: inline-block;
                          border-top: solid 1px currentColor;
                          width: 0.3em;
                          height: 0.25em;
                        }
                        .search-icon:after {
                          content: '';
                          display: inline-block;
                          border: solid 1.3px currentColor;
                          border-radius: 1em;
                          width: 0.5em;
                          height: 0.5em;
                        }
                        </style>` }),
                  ]
                }),
                rightStatus = elem('div', {
                  style: `
                    font-size: 80%;
                    align-self: center;
                    padding-right: 0.3em;
                    text-align: center;
                    line-height: 1;
                  `
                })
              ]
            }),
            subtitleArea = elem('div', 'color: gold; z-index: 200; position: relative;'),
            bottomStatusLine = createBottomStatusLine()
          ]
        });
        canvas3D.style.cssText = `
        position: fixed;
        left: 0; top: 0; width: 100%; height: 100%;
        `;
        canvas3D.className = 'atlas-3d';
        statsElem.style.position = 'relative';

        const status = createStatusRenderer(rightStatus);
        return { root, titleBar, subtitleArea, title, rightStatus, status, bottomStatusLine };

        /** @param {HTMLElement} rightStatus */
        function createStatusRenderer(rightStatus) {
          let cameraPos, cameraMovementIcon;

          const usersCountStr = userCount.toString();
          elem('div', {
            parent: rightStatus,
            children: [
              elem('div', {
                innerHTML:
                  usersCountStr.slice(0, 3) +
                  '<span style="display: inline-block; width: 0.1em;"></span>' +
                  usersCountStr.slice(3)
              }),
              elem('div', { textContent: 'users' }),
            ]
          });

          const cameraStatusLine = elem('div', {
            parent: rightStatus,
            style: `font-size: 80%; opacity: 0.7; margin-top: 0.3em; transition: opacity 2s;`,
            children: [
              cameraPos = elem('span', { textContent: '0.00, 0.00, 0.00' }),
              elem('span', { style: 'display: inline-block; width: 0.25em;' }),
              cameraMovementIcon = elem('span', { textContent: '>' }),
            ]
          });

          return {
            update
          };

          /**
           * @param {THREE.PerspectiveCamera} camera
           * @param {boolean} rotating
           * @param {boolean} fallbackFirehoseMode
           */
          function update(camera, rotating, fallbackFirehoseMode) {
            cameraPos.textContent =
              camera.position.x.toFixed(2) + ', ' + camera.position.y.toFixed(2) + ', ' + camera.position.z.toFixed(2);
            cameraMovementIcon.textContent = rotating ? (fallbackFirehoseMode ? '>>' : '>') : (fallbackFirehoseMode ? '|||' : '||');
            cameraStatusLine.style.opacity = rotating ? '0.4' : '0.7';
          }
        }

        function createBottomStatusLine() {
          let flashesSection, labelsElem, hitTestElem, flashesElem,
            likesElem, postsElem, repostsElem, followsElem,
            unknownsPerSecElem, unknownsTotalElem;

          let flashStatsHidden = true;
          const bottomStatusLine = /** @type {HTMLDivElement & { update(outcome, labelsOutcome) }} */(elem('div', {
            style: `
                grid-row: 5;
                color: #cc903b;
                z-index: 10;
                font-size: 80%;
                text-shadow: 6px -2px 7px black, -3px -6px 7px black, 5px 4px 7px black;
                padding: 0.25em;
                padding-right: 0.5em;
                text-align: right;
                line-height: 1.5;
                pointer-events: none;
            `,
            children: [
              elem('div', {
                children: [elem('a', {
                  href: 'https://bsky.app/profile/oyin.bo', innerHTML: 'created by <b>@oyin.bo</b>',
                  style: 'color: gray; text-decoration: none; font-weight: 100; pointer-events: all;'
                })]
              }),
              elem('div', {
                children: [elem('a', {
                  href: 'https://bsky.jazco.dev/', innerHTML: 'exploiting geo-spatial data from <b>@jaz.bsky.social</b>',
                  style: 'color: gray; text-decoration: none; font-weight: 100; pointer-events: all;'
                })]
              }),
              elem('div', { height: '0.5em' }),
              elem('div', {
                pointerEvents: 'all',
                children: [
                  flashesSection = elem('span', {
                    children: [
                      elem('span', { opacity: '0.6', textContent: 'L' }),
                      labelsElem = elem('span', { opacity: '0.8', textContent: '0' }),
                      elem('span', { opacity: '0.6', textContent: ' H' }),
                      hitTestElem = elem('span', { opacity: '0.8', textContent: '0' }),
                      ' *',
                      flashesElem = elem('span', '0'),
                      ' '],
                    display: flashStatsHidden ? 'none' : 'inline',
                    color: 'cornflowerblue'
                  }),
                  'posts+',
                  postsElem = elem('span', { color: 'gold' }),
                  ' ♡+',
                  likesElem = elem('span', { color: 'gold' }),
                  ' RT+',
                  repostsElem = elem('span', { color: 'gold' }),
                  ' follows+',
                  followsElem = elem('span', { color: 'gold' }),
                  ' ',
                  elem('span', { textContent: '+', color: '#1ca1a1' }),
                  unknownsPerSecElem = elem('span', { color: 'cyan' }),
                  elem('span', { textContent: '/', color: '#1ca1a1' }),
                  unknownsTotalElem = elem('span', { color: 'cyan' }),
                  elem('span', { textContent: '?', color: '#1ca1a1' })
                ]
              }),
            ]
          }));
          bottomStatusLine.addEventListener('click', () => {
            flashStatsHidden = !flashStatsHidden;
            flashesSection.style.display = flashStatsHidden ? 'none' : 'inline';
          });

          bottomStatusLine.update = update;
          return bottomStatusLine;

          function update(outcome, labelsOutcome) {
            labelsElem.textContent = labelsOutcome.labelCount.toString();
            hitTestElem.textContent = labelsOutcome.hitTestCount.toString();
            flashesElem.textContent = outcome.flashes.toString();
            likesElem.textContent = outcome.likes.toString();
            postsElem.textContent = outcome.posts.toString();
            repostsElem.textContent = outcome.reposts.toString();
            followsElem.textContent = outcome.follows.toString();
            unknownsPerSecElem.textContent = outcome.unknowns.toString();
            unknownsTotalElem.textContent = outcome.unknownsTotal.toString();
            outcome.likes = 0;
            outcome.posts = 0;
            outcome.reposts = 0;
            outcome.follows = 0;
            outcome.unknowns = 0;
          }

        }

      }

      /**
       * @param {{
       *  titleBarElem: HTMLElement,
       *  onSearchText: (searchText: string) => void,
       *  onClose: () => void
       * }} _
       */
      function searchUIController({ titleBarElem, onSearchText, onClose }) {
        /** @type {HTMLElement} */
        var searchBar;
        /** @type {HTMLInputElement} */
        var searchInput;
        /** @type {HTMLButtonElement} */
        var closeButton;

        var searchClosedAt = 1;

        const controller = {
          showSearch,
          closeSearch
        };

        titleBarElem.addEventListener('click', () => {
          if (Date.now() - searchClosedAt < 500) return;
          showSearch();
        });

        return controller;

        function showSearch() {
          if (!searchClosedAt) return;
          searchClosedAt = 0;

          if (!searchBar) {
            searchBar = elem('div', {
              parent: titleBarElem,
              style: 'position: relative; border-bottom: solid 1px #888;',
              children: [
                searchInput = elem('input', {
                  style: `
                  position: relative;
                  left: 0; top: 0; width: 100%; height: 100%;
                  background: transparent;
                  color: gold;
                  border: none;
                  outline: none;
                  `,
                  onkeydown: (event) => {
                    if (event.keyCode === 27) {
                      onClose();
                      closeSearch();
                    }
                    handleInputEventQueue(event);
                  },
                  onkeyup: handleInputEventQueue,
                  onkeypress: handleInputEventQueue,
                  onmousedown: handleInputEventQueue,
                  onmouseup: handleInputEventQueue,
                  onmouseleave: handleInputEventQueue,
                  onchange: handleInputEventQueue,
                  oninput: handleInputEventQueue,
                  placeholder: '    find accounts...'
                }),
                closeButton = elem('button', {
                  style: `
                    position: absolute; right: 0; top: 0; width: 2em; height: 100%;
                    background: transparent; border: none; outline: none;
                    color: gold; font-size: 80%;
                    cursor: pointer;
                    `,
                  textContent: '\u00d7', // cross like x, but not a letter
                  onclick: (event) => {
                    event.preventDefault();
                    onClose();
                    closeSearch();
                  }
                })
              ]
            });
          }
          searchBar.style.display = 'block';
          searchInput.focus();
        }

        function closeSearch() {
          if (searchClosedAt) return;
          searchClosedAt = Date.now();

          setTimeout(() => {
            searchBar.style.display = 'none';
            searchInput.value = '';
            clearTimeout(debounceTimeoutSearchInput);
          }, 100);
        }

        var debounceTimeoutSearchInput;
        /** @param {Event} event */
        function handleInputEventQueue(event) {
          clearTimeout(debounceTimeoutSearchInput);
          if (searchClosedAt) return;
          debounceTimeoutSearchInput = setTimeout(handleInputEventDebounced, 200);
        }

        var latestSearchInputApplied;
        function handleInputEventDebounced() {
          if (searchClosedAt) return;
          const currentSearchInputStr = (searchInput.value || '').trim();
          if (currentSearchInputStr === latestSearchInputApplied) return;

          console.log('search to run: ', currentSearchInputStr);
          latestSearchInputApplied = currentSearchInputStr;
          onSearchText(currentSearchInputStr);
        }
      }

      /** @param {HTMLElement} subtitleArea */
      function searchReportNoMatches(subtitleArea) {
        subtitleArea.innerHTML = '<div style="font-style: italic; font-size: 80%; text-align: center; opacity: 0.6;">No matches.</div>';
      }

      /**
       * @param {{
       *  matches: { user: UserEntry, rank: number }[],
       *  subtitleArea: HTMLElement,
       *  onChipClick: (shortDID: string, chip: HTMLElement) => void
       * }} _
       */
      function searchReportMatches({ matches, subtitleArea, onChipClick }) {
        subtitleArea.innerHTML = '';
        let scroller;
        const scrollerWrapper = elem('div', {
          parent: subtitleArea,
          style: `
            position: absolute;
            width: 100%;
            height: 2.5em;
            overflow: hidden;
            font-size: 80%;
            margin-top: 0.5em;
            `,
          children: [scroller = elem('div', {
            parent: subtitleArea,
            style: `
            position: absolute;
            overflow: auto;
            white-space: nowrap;
            width: 100%;
            height: 4em;
            padding-top: 0.2em;
            `
          })
          ]
        });

        for (let iMatch = 0; iMatch < Math.min(10, matches.length); iMatch++) {
          const match = matches[iMatch];

          const matchElem = elem('span', {
            parent: scroller,
            style: `
                margin-left: 0.3em;
                padding: 0px 0.4em 0.2em 0.2em;
                cursor: pointer;
                display: inline-box;
                border: 1px solid rgba(255, 215, 0, 0.28);
                border-radius: 1em;
                background: rgb(88 74 0 / 78%);
                text-shadow: 1px 1px 2px #0000004f;
                box-shadow: 2px 2px 7px #000000a8;
              }
              `,
            children: [
              elem('span', {
                children: [
                  elem('span', { textContent: '@', style: 'opacity: 0.5; display: inline-block; transform: scale(0.8) translateY(0.05em);' }),
                  match.user.shortHandle,
                  !match.user.displayName ? undefined : elem('span', {
                    textContent: ' ' + match.user.displayName,
                    style: `
                        opacity: 0.6;
                        display: inline-block;
                        zoom: 0.7;
                        transform: scaleY(1.3) translateY(0.15em);
                        transform-origin: center;
                        max-width: 6em;
                        overflow: hidden;
                        white-space: nowrap;
                        padding-left: 0.25em;
                      `
                  })
                ]
              })
            ],
            onclick: () => {
              onChipClick(match.user.shortDID, matchElem);
            }
          });

        }
      }

      /** @type {{ highlight(), dispose(), shortDID: string }[]} */
      var higlightUserStack;
      /**
       * @param {{
       *  shortDID: string,
       *  users: { [shortDID: string]: UserEntry },
       *  scene: THREE.Scene,
       *  camera: THREE.Camera,
       *  moveAndPauseRotation: (coord: {x: number, y: number, h: number}, towards: {x: number, y: number, h: number}) => void
       * }} _param
       */
      function focusAndHighlightUser({ shortDID, users, scene, camera, moveAndPauseRotation }) {
        const MAX_HIGHLIGHT_COUNT = 25;
        while (higlightUserStack?.length > MAX_HIGHLIGHT_COUNT) {
          const early = higlightUserStack.shift();
          early?.dispose?.();
        }

        const existingEntry = higlightUserStack?.find(entry => entry.shortDID === shortDID);
        if (existingEntry) {
          existingEntry.highlight();
          return;
        }

        const user = users[shortDID];
        const r = distance2D(user.x, user.y, 0, 0);
        const angle = Math.atan2(user.y, user.x);
        const xPlus = (r + 0.09) * Math.cos(angle);
        const yPlus = (r + 0.09) * Math.sin(angle);
        const hPlus = user.h + 0.04;

        const userColor = rndUserColorer(shortDID);

        const material = new THREE.MeshLambertMaterial({
          color: userColor,
          transparent: true,
          opacity: 0.9,
          // emissive: userColor,
        });
        const stem = new THREE.CylinderGeometry(0.0005, 0.00001, 0.001);
        const ball = new THREE.SphereGeometry(0.002);
        const stemMesh = new THREE.Mesh(stem, material);
        const ballMesh = new THREE.Mesh(ball, material);
        stemMesh.position.set(user.x, user.h + 0.0062, user.y);
        stemMesh.scale.set(1, 11.5, 1);

        ballMesh.position.set(user.x, user.h + 0.0136, user.y);
        scene.add(stemMesh);
        scene.add(ballMesh);

        const handleText = new troika_three_text.Text();
        handleText.text = '@' + user.shortHandle;
        handleText.fontSize = 0.01;
        handleText.color = userColor;
        handleText.outlineWidth = 0.0005;
        handleText.outlineBlur = 0.005;
        handleText.position.set(-0.005, 0.03, 0);
        handleText.onAfterRender = () => {
          applyTextBillboarding();
        };

        const group = new THREE.Group();
        group.position.set(user.x, user.h, user.y);
        group.add(/** @type {*} */(handleText));

        const displayNameText = user.displayName ? new troika_three_text.Text() : undefined;
        if (displayNameText) {
          displayNameText.text = /** @type {string} */(user.displayName);
          displayNameText.fontSize = 0.004;
          const co = new THREE.Color(userColor);
          co.offsetHSL(0, 0, 0.15);
          displayNameText.color = co.getHex();
          displayNameText.outlineWidth = 0.0003;
          displayNameText.outlineBlur = 0.005;
          displayNameText.position.set(0.005, 0.017, 0.0001);
          displayNameText.fontWeight = /** @type {*} */(200);
          group.add(/** @type {*} */(displayNameText));
        }

        scene.add(group);
        handleText.sync();
        if (displayNameText) displayNameText.sync();

        highlightUser();

        if (!higlightUserStack) higlightUserStack = [{ shortDID, dispose: unhighlightUser, highlight: highlightUser }];
        else higlightUserStack.push({ shortDID, dispose: unhighlightUser, highlight: highlightUser });

        function applyTextBillboarding() {
          group.rotation.y = Math.atan2(
            (camera.position.x - group.position.x),
            (camera.position.z - group.position.z));
          handleText.sync();
        }

        function highlightUser() {
          moveAndPauseRotation({ x: xPlus, y: yPlus, h: hPlus }, user);
        }

        function unhighlightUser() {
          scene.remove(group);
          handleText.dispose();

          scene.remove(stemMesh);
          scene.remove(ballMesh);
          material.dispose();
          stem.dispose();
          ball.dispose();

          /** @type {*} */(focusAndHighlightUser).unhighlightUser = undefined;
        }
      }

      /**
       * @param {{
       *  touchElement: HTMLElement,
       *  uxElements: Element[],
       *  renderElements: Element[],
       *  touchCallback: (xy: { x: number, y: number }) => void
       * }} _
       */
      function trackTouchWithCallback({ touchElement, uxElements, renderElements, touchCallback }) {
        touchElement.addEventListener('touchstart', handleTouch);
        touchElement.addEventListener('touchend', handleTouch);
        touchElement.addEventListener('touchmove', handleTouch);
        touchElement.addEventListener('mousedown', handleMouse);
        touchElement.addEventListener('mousemove', handleMouse);
        touchElement.addEventListener('mouseup', handleMouse);

        /** @type {{ x: number, y: number} | undefined} */
        var touchCoords;
        var touchTimeout;

        /** @param {Event} event */
        function genuineUX(event) {
          var testElem = /** @type {Element | null | undefined} */(event.target);
          while (testElem && testElem !== document.body) {
            if (uxElements.indexOf(testElem) >= 0) return true;
            if (renderElements.indexOf(testElem) >= 0) return false;
            testElem = testElem.parentElement;
          }
          return true;
        }

        /**@param {TouchEvent} event */
        function handleTouch(event) {
          if (genuineUX(event)) return;
          event.preventDefault();
          event.stopPropagation();

          const touches = event.changedTouches || event.targetTouches || event.touches;
          if (touches?.length) {
            for (const t of touches) {
              touchCoords = { x: t.pageX || t.clientX, y: t.pageY || t.clientY };
              break;
            }
          }

          if (!touchTimeout) {
            touchTimeout = setTimeout(processTouch, 100);
          }
        }

        /**@param {MouseEvent} event */
        function handleMouse(event) {
          if (genuineUX(event)) return;

          touchCoords = { x: event.pageX ?? event.clientX, y: event.pageY ?? event.clientY };
          event.preventDefault();
          if (!touchTimeout) {
            touchTimeout = setTimeout(processTouch, 100);
          }
        }

        function processTouch() {
          touchTimeout = undefined;
          if (!touchCoords) return;

          if (touchCallback) {
            const passEvent = touchCoords;
            touchCoords = undefined;
            if (typeof touchCallback === 'function')
              touchCallback(passEvent);
          }
        }
      }

      /**
       * @param {{
       *  users: UserEntry[],
       *  tiles: UserEntry[][],
       *  tileDimensionCount: number,
       *  clock: ReturnType<typeof makeClock>
       * }} _
       */
      function renderGeoLabels({ users, tiles, tileDimensionCount, clock }) {
        const ANIMATE_LENGTH_SEC = 0.7;
        const MIN_SCREEN_DISTANCE = 0.5;
        /**
         * @typedef {ReturnType<typeof createLabel>} LabelInfo
         */

        const avatarTextureLoader = new THREE.TextureLoader();
        const avatarRequestQueue = createThrottledQueue(3, 300);
        let avatarRequestSuccesses = 0;
        let avatarRequestFailures = 0;

        /** @type {{ [shortDID: string]: string | Promise<string> & { priority: number } }} */
        const avatarCids = {};

        const atClient = new atproto.BskyAgent({ service: 'https://bsky.social/xrpc' });

        const layerGroup = new THREE.Group();

        /** @type {Set<LabelInfo>[]} */
        const labelsByTiles = [];
        const labelsByShortDID = {};

        const pBuf = new THREE.Vector3();

        const outcome = {
          layerGroup,
          updateWithCamera,
          labelCount: 0,
          hitTestCount: 0
        };

        addFixedUsers();

        return outcome;

        function addFixedUsers() {
          const fixedUsers = getFixedUsers();
          for (const user of fixedUsers) {
            const label = createLabel(user);
            label.fixed = true;
            const xTileIndex = Math.floor((user.x + 1) / 2 * tileDimensionCount);
            const yTileIndex = Math.floor((user.y + 1) / 2 * tileDimensionCount);
            const tileIndex = xTileIndex + yTileIndex * tileDimensionCount;
            const tileBucket = labelsByTiles[tileIndex] || (labelsByTiles[tileIndex] = new Set());
            tileBucket.add(label);
            labelsByShortDID[user.shortDID] = label;
            layerGroup.add(label.group);
          }
        }

        /** @typedef {{ shortDID: string, x: number, y: number, h: number, weight: number }} TileUserEntry */

        function getFixedUsers() {
          const include = [
            'oyin.bo', 'africanceleb', 'ohkafuimykafui', 'jaz', 'kite.black', 'mathan.dev', 'wolfigelkott.crimea.ua',
            'tressiemcphd', 'theferocity', 'reniadeb', 'kevinlikesmaps', 'rasmansa','thieflord.dev',
            'twoscooters', 'finokoye', 'teetotaller', 'hystericalblkns', 'faytak', 'xkcd.com'];
          const exclude = ['dougchu'];
          const MAX_NUMBER_OF_LARGEST = 300;
          const MIN_DISTANCE = 0.1;

          /** @type {UserEntry[]} */
          const fixedUsers = [];

          /** @type {UserEntry[]} */
          const largestUsers = [];

          for (const user of users) {
            const userTooSmall = largestUsers.length === MAX_NUMBER_OF_LARGEST && user.weight <= largestUsers[largestUsers.length - 1].weight;

            if (userTooSmall && fixedUsers.length === include.length) continue;

            if (exclude.indexOf(user.shortHandle) >= 0) continue;
            if (include.indexOf(user.shortHandle) >= 0) {
              fixedUsers.push(user);
              continue;
            }

          }

          pruneCrowdedNeighbours(largestUsers);

          return fixedUsers.concat(largestUsers);

          /** @param {{ shortDID: string, x: number, y: number, weight: number }[]} largestUsers */
          function pruneCrowdedNeighbours(largestUsers) {
            for (let i = 1; i < largestUsers.length; i++) {
              const current = largestUsers[i];
              for (let j = 0; j < i; j++) {
                const prev = largestUsers[j];
                const dist = distance2D(prev.x, prev.y, current.x, current.y);
                if (dist < MIN_DISTANCE) {
                  largestUsers.splice(i, 1);
                  i--;
                  break;
                }
              }
            }
          }
        }

        /** @param {UserEntry} user */
        function createLabel(user) {
          /** @type {THREE.MeshBasicMaterial | undefined} */
          let lineMaterial;

          /** @type {THREE.Texture} */
          let avatarTexture;

          /** @type {THREE.Material} */
          let avatarMaterial;

          /** @type {THREE.CircleGeometry} */
          let avatarGeometry;

          /** @type {THREE.Mesh} */
          let avatarMesh;

          let xmin, ymin, xmax, ymax;

          outcome.labelCount++;

          const text = new troika_three_text.Text();
          text.text = '@' + user.shortHandle;
          text.fontSize = 0.004;
          text.color = user.colorRGB;
          text.outlineWidth = 0.00043;
          text.outlineBlur = 0.0016;
          text.position.set(0.003, 0.004, 0);
          text.sync(() => {
            const visibleBounds = text.textRenderInfo?.visibleBounds
            if (!visibleBounds) return;
            [xmin, ymin, xmax, ymax] = visibleBounds;

            if (!lineMaterial)
              lineMaterial = new THREE.MeshBasicMaterial({ color: user.colorRGB, transparent: true });

            const underlineOffset = -0.006;
            const startOffset = 0.0015;
            const geometry = new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(0,0,0),
              new THREE.Vector3(xmin + text.position.x + startOffset, text.position.y + underlineOffset, 0),
              new THREE.Vector3(xmax + text.position.x, text.position.y + underlineOffset, 0),
            ]);

            const line = new THREE.Line(geometry, lineMaterial);
            group.add(line);
          });

          const group = new THREE.Group();
          group.position.set(user.x, user.h, user.y);
          group.add(/** @type {*} */(text));
          group.rotation.z = 0.3;

          const label = {
            user,
            addedAtSec: clock.nowSeconds,
            group,
            fixed: false,
            searchResult: false,
            animationEndsAtSec: clock.nowSeconds + ANIMATE_LENGTH_SEC,
            visible: true,
            screenX: NaN,
            screenY: NaN,
            textWidth: NaN,
            textHeight: NaN,
            updateWithCamera,
            dispose
          };

          retrieveAvatar();

          return label;

          function dispose() {
            group.clear();
            text.dispose();
            lineMaterial?.dispose();
            avatarTexture?.dispose();
            avatarMaterial?.dispose();
            avatarGeometry?.dispose();
            outcome.labelCount--;
          }

          /** @param {THREE.Vector3} cameraPos */
          function updateWithCamera(cameraPos) {
            const SCALE_LABELS_CLOSER_THAN = 0.23;
            const trueVisible = label.visible ||
              label.animationEndsAtSec >= clock.nowSeconds;

            if (trueVisible) {
              group.visible = true;
              group.rotation.y = Math.atan2(
                (cameraPos.x - group.position.x),
                (cameraPos.z - group.position.z));

              const scale = cameraPos.distanceTo(group.position) < SCALE_LABELS_CLOSER_THAN ?
                cameraPos.distanceTo(group.position) / SCALE_LABELS_CLOSER_THAN :
                1 + (cameraPos.distanceTo(group.position) / SCALE_LABELS_CLOSER_THAN - 1) * 0.2;
              group.scale.set(scale, scale, scale);

              if (xmin && xmax) {
                label.textWidth = (xmax - xmin) * scale;
                label.textHeight = (ymax - ymin) * scale;
              }

              // 0 to 1 when animation ends
              const animationPhase = (clock.nowSeconds - (label.animationEndsAtSec - ANIMATE_LENGTH_SEC)) / ANIMATE_LENGTH_SEC;

              const opacity =
                // after animation finished, steady state
                animationPhase > 1 ? (label.visible ? 1 : 0) :
                  // fade in
                  label.visible ? animationPhase :
                    // fade out
                    1 - animationPhase;

              text.strokeOpacity = text.outlineOpacity = opacity * opacity;
              text.fillOpacity = opacity;
              if (lineMaterial && lineMaterial?.opacity !== opacity) {
                lineMaterial.opacity = opacity;
                lineMaterial.needsUpdate = true;
              }

              const avatarRequest = avatarRequestQueue.queued[user.shortDID];
              if (avatarRequest)
                avatarRequest.priority += 1;

              if (avatarMaterial && avatarMaterial.opacity !== opacity) {
                avatarMaterial.opacity = opacity;
                avatarMaterial.needsUpdate = true;
              }

              text.sync();
            } else {
              group.visible = false;
              delete avatarRequestQueue.queued[user.shortDID];
            }
          }

          function retrieveAvatar() {
            if (!avatarRequestSuccesses && avatarRequestFailures > 5) {
              avatarRequestQueue.concurrency = 0;
              return;
            }

            let avatarCidPromise = avatarCids[user.shortDID];
            if (avatarCidPromise === 'none') return;
            if (typeof avatarCidPromise === 'string') return makeAvatarTexture(avatarCidPromise);
            if (avatarCidPromise) avatarCidPromise.priority += 1;
            else avatarCidPromise = avatarCids[user.shortDID] = avatarRequestQueue.eventually(user.shortDID, getAvatarCid);

            avatarCidPromise.then(makeAvatarTexture);

            async function getAvatarCid() {
              try {
                const { data } = await atClient.com.atproto.repo.listRecords({ repo: unwrapShortDID(user.shortDID), collection: 'app.bsky.actor.profile' });
                let avatarCid = /** @type {*} */(data.records?.[0]?.value)?.avatar?.ref?.toString();
                if (!avatarCid) avatarCid = 'none';
                else avatarRequestSuccesses++;
                avatarCids[user.shortDID] = avatarCid;
                return avatarCid;
              } catch (avatarReqError) {
                avatarRequestFailures++;
                return 'none';
              }
            }

            /** @param {string} avatarCid  */
            async function makeAvatarTexture(avatarCid) {
              if (!avatarCid || avatarCid === 'none') return;
              if (labelsByShortDID[user.shortDID]) return;

              const avatarUrl = 'https://bsky.social/xrpc/com.atproto.sync.getBlob?did=' + unwrapShortDID(user.shortDID) + '&cid=' + avatarCid;

              avatarTexture = await avatarTextureLoader.loadAsync(avatarUrl);

              avatarMaterial = new THREE.MeshBasicMaterial({ map: avatarTexture, color: 0xffffff });
              avatarMaterial.transparent = true;
              avatarGeometry = new THREE.CircleGeometry(0.0014, 16);
              avatarMesh = new THREE.Mesh(avatarGeometry, avatarMaterial);
              avatarMesh.position.set(0.005, 0.00068, 0);
              text.text = text.text.slice(1);
              text.position.set(0.0065, 0.004, 0);
              text.sync();

              group.add(avatarMesh);
            }
          }
        }

        var lastUpdateTextLabelsMsec;

        /** @param {THREE.PerspectiveCamera} camera */
        function updateWithCamera(camera) {
          const UPDATE_TEXT_LABELS_INTERVAL_MSEC = 2000;

          const cameraPos = camera.position;
          camera.updateMatrixWorld();

          for (const tileBucket of labelsByTiles) {
            if (!tileBucket) continue;
            let removeLabels;
            for (const label of tileBucket) {
              label.updateWithCamera(cameraPos);
              if (!label.visible && !label.fixed && label.animationEndsAtSec < clock.nowSeconds) {
                if (!removeLabels) removeLabels = [label];
                else removeLabels.push(label);
              }
            }

            if (removeLabels) {
              for (const label of removeLabels) {
                tileBucket.delete(label);
                layerGroup.remove(label.group);
                label.dispose();
                delete labelsByShortDID[label.user.shortDID];
              }
            }
          }

          if (!lastUpdateTextLabelsMsec || clock.nowMSec - lastUpdateTextLabelsMsec > UPDATE_TEXT_LABELS_INTERVAL_MSEC) {
            lastUpdateTextLabelsMsec = clock.nowMSec;

            refreshDynamicLabels(camera);
          }

        }

        /** @param {THREE.PerspectiveCamera} camera */
        function refreshDynamicLabels(camera) {
          let numberOfTests = 0;
          const testArgs = /** @type {Parameters<typeof nearestLabel<LabelInfo, { screenX: number, screenY: Number, visible?: boolean }>>[0]} */({
            tileDimensionCount,
            tileX: 0, tileY: 0, testLabel: { screenX: NaN, screenY: NaN },
            tiles: labelsByTiles,
            isCloseTo: (toLabel, testLabel) => {
              numberOfTests++;
              return Math.max(0, MIN_SCREEN_DISTANCE - labelsDistanceTo(toLabel, testLabel))
            },
            isVisible: (label) => label.visible
          });

          for (let xIndex = 0; xIndex < tileDimensionCount; xIndex++) {
            for (let yIndex = 0; yIndex < tileDimensionCount; yIndex++) {
              const tileIndex = xIndex + yIndex * tileDimensionCount;

              const allTileUsers = tiles[tileIndex];
              if (!allTileUsers) continue; // some tiles are empty (rectangular world, round galaxy)

              const tileLabels = labelsByTiles[tileIndex] || (labelsByTiles[tileIndex] = new Set());
              testArgs.tileX = xIndex;
              testArgs.tileY = yIndex;

              for (const existingLabel of tileLabels) {
                pBuf.set(existingLabel.user.x, existingLabel.user.h, existingLabel.user.y);
                pBuf.project(camera);
                existingLabel.screenX = pBuf.x;
                existingLabel.screenY = pBuf.y;

                if (existingLabel.fixed) continue;

                testArgs.testLabel = existingLabel;

                let shouldBeRemoved = nearestLabel(testArgs);
                if (shouldBeRemoved) {
                  if (existingLabel.visible) {
                    existingLabel.visible = false;
                    const remainingFadeTime = existingLabel.animationEndsAtSec > clock.nowSeconds ?
                      ANIMATE_LENGTH_SEC - (existingLabel.animationEndsAtSec - clock.nowSeconds) :
                      ANIMATE_LENGTH_SEC;
                    existingLabel.animationEndsAtSec = clock.nowSeconds + remainingFadeTime;
                  }
                } else {
                  if (!existingLabel.visible) {
                    existingLabel.visible = true;
                    const remainingFadeTime = existingLabel.animationEndsAtSec > clock.nowSeconds ?
                      ANIMATE_LENGTH_SEC - (existingLabel.animationEndsAtSec - clock.nowSeconds) :
                      ANIMATE_LENGTH_SEC;
                    existingLabel.animationEndsAtSec = clock.nowSeconds + remainingFadeTime;
                  }
                }
              }

              testArgs.testLabel = {screenX: NaN, screenY: NaN };
              for (const user of allTileUsers) {
                if (labelsByShortDID[user.shortDID]) continue;
                pBuf.set(user.x, user.h, user.y);
                pBuf.project(camera);

                testArgs.testLabel.screenX = pBuf.x;
                testArgs.testLabel.screenY = pBuf.y;

                if (nearestLabel(testArgs)) {
                  break;
                } else {
                  const label = createLabel(user);
                  label.screenX = pBuf.x;
                  label.screenY = pBuf.y;
                  tileLabels.add(label);
                  layerGroup.add(label.group);
                }
              }
            }
          }

          outcome.hitTestCount = numberOfTests;
        }

        /**
         * @param {LabelInfo} toLabel
         * @param {{ screenX: number, screenY: number }} testLabel
         */
        function labelsDistanceTo(toLabel, testLabel) {
          return distance2D(
            toLabel.screenX + (toLabel.textWidth || 0) * 0.8,
            toLabel.screenY + (toLabel.textHeight || 0) * 3,
            testLabel.screenX,
            testLabel.screenY);
        }
      }

      /**
       * @param {THREE.PerspectiveCamera} camera
       * @param {THREE.WebGLRenderer} renderer
       */
      function handleWindowResizes(camera, renderer) {
        window.addEventListener('resize', onWindowResize);

        function onWindowResize() {
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(window.innerWidth, window.innerHeight);
        }
      }

      /** @param {THREE.BufferGeometry} geometry */
      function geometryVertices(geometry) {
        const geoPos = geometry.getAttribute('position');
        const index = geometry.getIndex();
        if (index) {
          const positions = [];
          for (let i = 0; i < index.count; i++) {
            const posIndex = index.getX(i);
            positions.push(geoPos.getX(posIndex));
            positions.push(geoPos.getY(posIndex));
            positions.push(geoPos.getZ(posIndex));
          }
          return positions;
        } else {
          const positions = [];
          for (let i = 0; i < geoPos.count; i++) {
            positions.push(geoPos.getX(i));
            positions.push(geoPos.getY(i));
            positions.push(geoPos.getZ(i));
          }
          return positions;
        }
      }

      /**
       * @param {{
       *  clock: ReturnType<typeof makeClock>;
       *  userCount: number;
       *  fragmentShader?: string;
       *  vertexShader?: string;
       * }} _ 
       */
      function dynamicShaderRenderer({ clock, userCount, fragmentShader, vertexShader }) {
        const baseHalf = 1.5 * Math.tan(Math.PI / 6);
        let positions = new Float32Array([
          -baseHalf, 0, -0.5,
          0, 0, 1,
          baseHalf, 0, -0.5
        ]);
        let offsetBuf = new Float32Array(userCount * 4);
        let diameterBuf = new Float32Array(userCount);
        let extraBuf = new Float32Array(userCount * 2);
        let colorBuf = new Uint32Array(userCount);


        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(offsetBuf, 3));
        geometry.setAttribute('diameter', new THREE.InstancedBufferAttribute(diameterBuf, 1));
        geometry.setAttribute('extra', new THREE.InstancedBufferAttribute(extraBuf, 2));
        geometry.setAttribute('color', new THREE.InstancedBufferAttribute(colorBuf, 1));
        geometry.instanceCount = userCount;

        const material = new THREE.ShaderMaterial({
          uniforms: {
            time: { value: clock.nowSeconds }
          },
          vertexShader: /* glsl */`
            precision highp float;

            attribute vec3 offset;
            attribute float diameter;
            attribute vec2 extra;
            attribute uint color;

            uniform float time;

            varying vec3 vPosition;
            varying vec3 vOffset;
            varying float vDiameter;
            varying vec2 vExtra;

            varying float vFogDist;
            varying vec4 vColor;

            void main(){
              vPosition = position;
              vOffset = offset;
              vDiameter = diameter;
              vExtra = extra;

              gl_Position = projectionMatrix * (modelViewMatrix * vec4(offset, 1) + vec4(position.xz * abs(diameter), 0, 0));

              // https://stackoverflow.com/a/22899161/140739
              uint rInt = (color / uint(256 * 256 * 256)) % uint(256);
              uint gInt = (color / uint(256 * 256)) % uint(256);
              uint bInt = (color / uint(256)) % uint(256);
              uint aInt = (color) % uint(256);
              vColor = vec4(float(rInt) / 255.0f, float(gInt) / 255.0f, float(bInt) / 255.0f, float(aInt) / 255.0f);

              vFogDist = distance(cameraPosition, offset);

              ${vertexShader || ''}
            }
          `,
          fragmentShader: /* glsl */`
            precision highp float;

            uniform float time;

            varying vec4 vColor;
            varying float vFogDist;

            varying vec3 vPosition;
            varying vec3 vOffset;
            varying float vDiameter;
            varying vec2 vExtra;

            void main() {
              gl_FragColor = vColor;
              float dist = distance(vPosition, vec3(0.0));
              dist = vDiameter < 0.0 ? dist * 2.0 : dist;
              float rad = 0.25;
              float areola = rad * 2.0;
              float bodyRatio =
                dist < rad ? 1.0 :
                dist > areola ? 0.0 :
                (areola - dist) / (areola - rad);
              float radiusRatio =
                dist < 0.5 ? 1.0 - dist * 2.0 : 0.0;

              float fogStart = 0.6;
              float fogGray = 1.0;
              float fogRatio = vFogDist < fogStart ? 0.0 : vFogDist > fogGray ? 1.0 : (vFogDist - fogStart) / (fogGray - fogStart);

              vec4 tintColor = vColor;
              tintColor.a = radiusRatio;
              gl_FragColor = mix(gl_FragColor, vec4(1.0,1.0,1.0,0.7), fogRatio * 0.7);
              gl_FragColor = vDiameter < 0.0 ? vec4(0.6,0.0,0.0,1.0) : gl_FragColor;
              gl_FragColor.a = bodyRatio;

              vec3 position = vPosition;
              vec3 offset = vOffset;
              float diameter = vDiameter;
              vec2 extra = vExtra;

              ${fragmentShader || ''}
            }
          `,
          side: THREE.BackSide,
          forceSinglePass: true,
          transparent: true,
          depthWrite: false
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.onBeforeRender = () => {
          material.uniforms['time'].value = clock.nowSeconds;
        };
        return { mesh, updateUserSet };

        /**
         * @param {{ user: UserEntry, weight: number, start: number, stop: number }[]} users
         */
        function updateUserSet(users) {
          for (let i = 0; i < users.length; i++) {
            const { user, weight, start, stop } = users[i];
            offsetBuf[i * 3 + 0] = user.x;
            offsetBuf[i * 3 + 1] = user.h;
            offsetBuf[i * 3 + 2] = user.y;
            diameterBuf[i] = weight || user.weight;
            colorBuf[i] = user.colorRGB * 256 | 0xFF;
            extraBuf[i * 2 + 0] = start;
            extraBuf[i * 2 + 1] = stop;
          }

          geometry.attributes['offset'].needsUpdate = true;
          geometry.attributes['diameter'].needsUpdate = true;
          geometry.attributes['color'].needsUpdate = true;
          geometry.attributes['extra'].needsUpdate = true;

          geometry.instanceCount = users.length;
        }
      }

      /**
       * @param {{
       *  clock: ReturnType<typeof makeClock>;
       *  users: UserEntry[];
       * }} _ 
       */
      function massShaderRenderer({ clock, users }) {
        const baseHalf = 1.5 * Math.tan(Math.PI / 6);
        let positions = new Float32Array([
          -baseHalf, 0, -0.5,
          0, 0, 1,
          baseHalf, 0, -0.5
        ]);
        let offsetBuf = new Float32Array(users.length * 4);
        let diameterBuf = new Float32Array(users.length);
        let colorBuf = new Uint32Array(users.length);

        for (let i = 0; i < users.length; i++) {
          const user = users[i];
          offsetBuf[i * 3 + 0] = user.x;
          offsetBuf[i * 3 + 1] = user.h;
          offsetBuf[i * 3 + 2] = user.y;
          diameterBuf[i] = user.weight;
          colorBuf[i] = user.colorRGB * 256 | 0xFF;
        }

        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(offsetBuf, 3));
        geometry.setAttribute('diameter', new THREE.InstancedBufferAttribute(diameterBuf, 1));
        geometry.setAttribute('color', new THREE.InstancedBufferAttribute(colorBuf, 1));
        geometry.instanceCount = users.length;

        const material = new THREE.ShaderMaterial({
          uniforms: {
            time: { value: clock.nowSeconds }
          },
          vertexShader: /* glsl */`
            precision highp float;

            attribute vec3 offset;
            attribute float diameter;
            attribute uint color;

            uniform float time;

            varying vec3 vPosition;
            varying float vDiameter;

            varying float vFogDist;
            varying vec4 vColor;

            void main(){
              vPosition = position;
              vDiameter = diameter;

              gl_Position = projectionMatrix * (modelViewMatrix * vec4(offset, 1) + vec4(position.xz * abs(diameter), 0, 0));

              // https://stackoverflow.com/a/22899161/140739
              uint rInt = (color / uint(256 * 256 * 256)) % uint(256);
              uint gInt = (color / uint(256 * 256)) % uint(256);
              uint bInt = (color / uint(256)) % uint(256);
              uint aInt = (color) % uint(256);
              vColor = vec4(float(rInt) / 255.0f, float(gInt) / 255.0f, float(bInt) / 255.0f, float(aInt) / 255.0f);

              vFogDist = distance(cameraPosition, offset);
            }
          `,
          fragmentShader: /* glsl */`
            precision highp float;

            uniform float time;

            varying vec4 vColor;
            varying float vFogDist;

            varying vec3 vPosition;
            varying float vDiameter;

            void main() {
              gl_FragColor = vColor;
              float dist = distance(vPosition, vec3(0.0));
              dist = vDiameter < 0.0 ? dist * 2.0 : dist;
              float rad = 0.25;
              float areola = rad * 2.0;
              float bodyRatio =
                dist < rad ? 1.0 :
                dist > areola ? 0.0 :
                (areola - dist) / (areola - rad);
              float radiusRatio =
                dist < 0.5 ? 1.0 - dist * 2.0 : 0.0;

              float fogStart = 0.6;
              float fogGray = 1.0;
              float fogRatio = vFogDist < fogStart ? 0.0 : vFogDist > fogGray ? 1.0 : (vFogDist - fogStart) / (fogGray - fogStart);

              vec4 tintColor = vColor;
              tintColor.a = radiusRatio;
              gl_FragColor = mix(gl_FragColor, vec4(1.0,1.0,1.0,0.7), fogRatio * 0.7);
              gl_FragColor = vDiameter < 0.0 ? vec4(0.6,0.0,0.0,1.0) : gl_FragColor;
              gl_FragColor.a = bodyRatio;
            }
          `,
          side: THREE.BackSide,
          forceSinglePass: true,
          transparent: true,
          depthWrite: false
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.onBeforeRender = () => {
          material.uniforms['time'].value = clock.nowSeconds;
        };
        return mesh;
      }
    }

    /**
     * @param {TagName} tagName
     * @param {(
     *  Omit<
     *    Partial<HTMLElement['style']> &
     *     Partial<HTMLElementTagNameMap[TagName]
     *  >, 'children' | 'parent' | 'parentElement' | 'style'> &
     *  {
     *    children?: (Element | string | null | void | undefined)[],
     *    parent?: Element | null, 
     *    parentElement?: Element | null,
     *    style?: string | Partial<HTMLElement['style']>
     *  })=} [style]
     * @returns {HTMLElementTagNameMap[TagName]}
     * @template {string} TagName
     */
    function elem(tagName, style) {
      const el = document.createElement(tagName);

      if (style && typeof /** @type {*} */(style).appendChild === 'function') {
        const tmp = parent;
        style = /** @type {*} */(parent);
        parent = tmp;
      }

      if (typeof style === 'string') {
        if (/** @type{*} */(style).indexOf(':') >= 0) el.style.cssText = style;
        else el.className = style;
      }
      else if (style) {
        /** @type {Element | undefined} */
        let setParent;
        /** @type {Element[] | undefined} */
        let appendChildren;
        for (const key in style) {
          if (key === 'parent' || key === 'parentElement') {
            setParent = /** @type {*} */(style[key]);
            continue;
          }
          else if (key === 'children') {
            appendChildren = /** @type {*} */(style[key]);
            continue;
          }
          else if (style[key] == null || (typeof style[key] === 'function' && !(key in el))) continue;

          if (key in el.style) el.style[key] = /** @type {*} */(style[key]);
          else if (key in el) el[key] = style[key];
        }

        if (appendChildren) {
          for (const child of appendChildren) {
            if (child == null) continue;
            if (typeof child === 'string') {
              const childText = document.createTextNode(child);
              el.appendChild(childText);
            } else {
              el.appendChild(child);
            }
          }
        }

        if (setParent && typeof setParent.appendChild === 'function') setParent.appendChild(el);
      }

      return /** @type {*} */(el);
    }
  }

  async function runNode(invokeType) {
    const fs = require('fs');
    const path = require('path');
    const atproto = require('@atproto/api');

    // debugDumpFirehose();
    // syncAllJsonp();

    updateHotFromFirehose();

    /**
     * @param {string} filePath
     * @param {*} obj
     */
    function saveJsonp(filePath, obj) {
      const funcName = jsonpFuncName(filePath);
      const json = typeof obj === 'string' ? obj : JSON.stringify(obj);
      const jsonpWrapped =
        "var cursors=(function(jsonp){ if (typeof cursors==='function')cursors(jsonp); return cursors=jsonp })(".replace(
          /cursors/g,
          funcName
        ) +
        json +
        ') // ' + new Date().toISOString() + ' ' + process.platform + process.arch + ' node-' + process.versions.node + ' v8-' + process.versions.v8 + '\n';
      fs.writeFileSync(filePath, jsonpWrapped);
    }

    async function syncAllJsonp() {
      const jsonDir = path.resolve(__dirname, '../atlas-db');
      const jsonpDir = path.resolve(__dirname, '../atlas-db-jsonp');

      const jsonFiles = /** @type {string[]} */(fs.readdirSync(jsonDir, { recursive: true })).filter(f =>
        !/node_modules/i.test(f) &&
        /\.json$/i.test(f)).map(f => path.relative(jsonDir, path.resolve(jsonDir, f)));

      const jsonpFiles = /** @type {string[]} */(fs.readdirSync(jsonpDir, { recursive: true })).filter(f =>
        !/node_modules/i.test(f) &&
        /\.js$/i.test(f)).map(f => path.relative(jsonpDir, path.resolve(jsonpDir, f)));

      /**
       * @type {{ [relativePath: string]: {
       *  json?: { modified: number, contentModified?: number, data: any, jsonText: string },
       *  jsonp?: { modified: number, contentModified?: number, data: any, jsonText: string }
       * }}} */
      const pairs = {};
      for (const jsonFile of jsonFiles) {
        try {
          const rawText = fs.readFileSync(path.resolve(jsonDir, jsonFile), 'utf8');
          const contentModified = fishForContentModifiedDate(rawText);
          const jsonData = JSON.parse(rawText);
          const modified = fs.statSync(path.resolve(jsonDir, jsonFile)).mtimeMs;

          const key = jsonFile.replace(/\.json$/i, '');

          pairs[key] = {
            json: { modified, contentModified, data: jsonData, jsonText: rawText },
          }
        } catch (jsonError) {
          console.log('Error parsing ' + jsonFile + ': ' + jsonError.message);
        }
      }

      for (const jsonpFile of jsonpFiles) {
        const modified = fs.statSync(path.resolve(jsonpDir, jsonpFile)).mtimeMs;
        const rawText = fs.readFileSync(path.resolve(jsonpDir, jsonpFile), 'utf8');
        const jsonText = stripRawJsonFromJsonp(rawText);
        const key = jsonpFile.replace(/\.js$/i, '');
        if (!pairs[key]) {
          if (jsonText) {
            pairs[key] = { jsonp: { modified, contentModified: undefined, data: {}, jsonText: '' } };
          }
          continue;
        }
        if (!jsonText) {
          console.log('Cannot strip JSONP decoration from ' + jsonpFile);
          continue;
        }

        const contentModified = fishForContentModifiedDate(rawText);

        const jsonpData = await loadRelativeScriptJsonp(path.join('../atlas-db-jsonp', jsonpFile));

        const jsonpEntry = { modified, contentModified, data: jsonpData, jsonText };

        const existing = pairs[key];
        if (existing) existing.jsonp = jsonpEntry;
        else pairs[key] = { jsonp: jsonpEntry };
      }

      for (const relativePath in pairs) {
        const pairEntry = pairs[relativePath];
        if (pairEntry.json && !pairEntry.jsonp) {
          console.log(relativePath + ' has no JSONP counterparty');
          continue;
        }
        if (!pairEntry.json && pairEntry.jsonp) {
          console.log(relativePath + ' has no JSON counterparty');
          continue;
        }
        if (!pairEntry.json && !pairEntry.jsonp) continue;

        if (/** @type {*} */(pairEntry).json.contentModified > /** @type {*} */(pairEntry).jsonp.contentModified) {
          console.log(relativePath + ' json overwrites jsonP');
          saveJsonp(path.resolve(jsonpDir, relativePath + '.js'), pairEntry.json?.jsonText);
        } else {
          console.log(relativePath + ' jsonP overwrites json');
          fs.writeFileSync(path.resolve(jsonDir, relativePath + '.json'), /** @type {string} */(pairEntry.jsonp?.jsonText));
        }
      }

      /** @param {string} rawText */
      function fishForContentModifiedDate(rawText) {
        const leadLines = rawText.slice(0, 300).trim().split('\n').filter(ln => ln).slice(0, 2);
        const trailLines = rawText.slice(-300).trim().split('\n').filter(ln => ln).slice(-2);
        const anyLinesWithContentModifiedCaption = leadLines.concat(trailLines).filter(ln =>
          /\bcontent\s*Modified\b/i.test(ln));

        const contentModified = anyLinesWithContentModifiedCaption.map(ln => ln.split(/\s+/).map(w => {
          if (/^20\d\d\-[01]\d\-[0123]\d/.test(w)) {
            const dt = new Date(w);
            if (dt.getTime() > 0) return dt.getTime();
          }
        }).filter(dt => dt)[0]).filter(dt => dt)[0];

        return contentModified;
      }

      /** @param {string} jsonpText */
      function stripRawJsonFromJsonp(jsonpText) {
        const leadLine = jsonpText.slice(0, 300).trim().split('\n').filter(ln => ln)[0];

        const lastOpeningBracketPos = leadLine.lastIndexOf('(');
        if (lastOpeningBracketPos < 0) return undefined;
        const leadLength = jsonpText.indexOf(leadLine.slice(0, lastOpeningBracketPos + 1)) + lastOpeningBracketPos + 1;

        let trailChunk = jsonpText.slice(Math.max(leadLength + 1, jsonpText.length - 300));
        const trailTrimmed = trailChunk.trimEnd();
        const trailLastNewlinePos = trailTrimmed.lastIndexOf('\n');
        if (trailLastNewlinePos >= 0) trailChunk = trailTrimmed.slice(trailLastNewlinePos + 1);

        const firstClosingBracketPos = trailChunk.indexOf(')');
        if (firstClosingBracketPos < 0) return undefined;
        const trailLength = trailChunk.length - firstClosingBracketPos;
        const jsonText = jsonpText.slice(leadLength, -trailLength);
        return jsonText;
      }
    }

    async function updateHotFromFirehose() {
      const atClient = new atproto.BskyAgent({ service: 'https://bsky.social/xrpc' });

      console.log('Loading existing hot users...');

      /** @type {{ [shortDID: string]: UserTuple }} */
      const hotUsers = await loadRelativeScriptJsonp('../atlas-db-jsonp/users/hot.js');
      console.log('  ' + Object.keys(hotUsers).length + ' hot users');

      /** @type {typeof hotUsers} */
      const addedUsers = {};

      /** @type {{ [shortDID: string]: Promise | undefined}} */
      const handlingUsers = {};

      const fhManager = firehose({
        post(author, postID, text, replyTo, replyToThread, timeMsec) {
          checkUser(author, [replyTo?.shortDID, replyToThread?.shortDID]);
          if (replyTo?.shortDID) checkUser(replyTo.shortDID);
          if (replyToThread?.shortDID) checkUser(replyToThread.shortDID);
        },
        repost(who, whose, postID, timeMsec) {
          checkUser(who, [whose]);
          checkUser(whose, [who]);
        },
        like(who, whose, postID, timeMsec) {
          checkUser(who, [whose]);
          checkUser(whose, [who]);
        },
        follow(who, whom, timeMsec) {
          checkUser(who, [whom]);
          checkUser(whom, [who]);
        },
        error: (err) => {
          console.log('firehose error', err);
        }
      });

      var lastSaveAdded;

      /** @param {string} shortDID @param {(string | undefined)[]=} proximityTo */
      function checkUser(shortDID, proximityTo) {
        const now = Date.now();
        if (!lastSaveAdded) lastSaveAdded = now;
        else if (now - lastSaveAdded > 20000) {
          lastSaveAdded = now;
          console.log('Saving added users [' + Object.keys(addedUsers).length + ']...');
          const combined = { ...hotUsers, ...addedUsers };
          saveJsonp(path.resolve(__dirname, '../atlas-db-jsonp/users/hot.js'),
            '{\n' +
            Object.keys(combined).sort().map(shortDID =>
              JSON.stringify(shortDID) + ': ' + JSON.stringify(combined[shortDID])
            ).join(',\n') +
            '\n}'
          );
          console.log('  saved, ' + Object.keys(handlingUsers).length + ' in the queue\n\n');
        }

        if (hotUsers[shortDID] || addedUsers[shortDID]) return;
        const existingWork = handlingUsers[shortDID];
        if (existingWork) {
          /** @type {{count?:number}} */(existingWork).count =
            (/** @type {{count?:number}} */(existingWork).count || 0) + 1;
          return;
        }

        handlingUsers[shortDID] = (async () => {
          await enterQueue(shortDID);
          try {
            await loadUser(shortDID, proximityTo);
          } catch (error) {
            if (/rate/i.test(error.message) && /limit/i.test(error.message)) {
              const waitForMsec = 20 * 1000 + 10 * 1000 * Math.random();
              console.log('  ' + shortDID + ' failed ', error.message +
                ' (pausing for ' + Math.round(waitForMsec / 1000) + ' sec)');
              await new Promise(resolve => setTimeout(resolve, waitForMsec));
            } else {
              console.log('  ' + shortDID + ' failed ', error.message);
            }
          }
          delete handlingUsers[shortDID];
          exitQueue();
        })();
      }

      var running, queued;
      function enterQueue(shortDID) {
        const MAX_CONCURRENCY = 4;
        if ((running || 0) <= MAX_CONCURRENCY) {
          running = (running || 0) + 1;
          return;
        }

        return new Promise(resolve => {
          if (!queued) queued = [];
          /** @type {{ shortDID?: string}} */(resolve).shortDID = shortDID;
          queued.push(resolve);
        });
      }

      function exitQueue() {
        running--;
        if (queued && queued.length) {
          running++;
          queued.sort((q1, q2) => {
            const c1 = /** @type {{ count?: number }} */(handlingUsers[q1.shortDID])?.count || 0;
            const c2 = /** @type {{ count?: number }} */(handlingUsers[q2.shortDID])?.count || 0;
            return c2 - c1;
          });
          const topUnqueue = queued.shift();
          // const priority = /** @type {{ count?: number }} */(handlingUsers[topUnqueue.shortDID])?.count;
          // priority?.toString();
          topUnqueue();
        }
      }

      /** @param {string} shortDID @param {(string | undefined)[]=} proximityTo */
      async function loadUser(shortDID, proximityTo) {
        await new Promise(resolve => setTimeout(resolve, 400 + 550 * Math.random()));

        const shortHandle = await getDidHandle(shortDID);
        console.log('Placing ' + shortHandle + '...');

        await new Promise(resolve => setTimeout(resolve, 50 + 20 * Math.random()));
        const displayName = await getDidDisplayName(shortDID);
        await new Promise(resolve => setTimeout(resolve, 50 + 20 * Math.random()));
        const follows = await getUserFollows(shortDID);
        await new Promise(resolve => setTimeout(resolve, 50 + 20 * Math.random()));
        const likes = await getUserLikes(shortDID);


        /** @type {typeof hotUsers} */
        const knownUserNeighbours = {};
        addUserNeightbours(proximityTo, 0.2);
        addUserNeightbours(follows, 1);
        addUserNeightbours(likes, 0.1);

        if (!Object.keys(knownUserNeighbours).length) {
          console.log('      ![' + shortHandle + '] abandoned due to no neighbours');
          return;
        }

        if (Object.keys(knownUserNeighbours).length < 3) {
          console.log('      ![' + shortHandle + '] abandoned due to insufficient neighbours: ',
            Object.values(knownUserNeighbours).map(usr => usr[0]));
          return;
        }

        const centre = getMassCenter(knownUserNeighbours);

        const x = parseFloat(centre.x.toFixed(2));
        const y = parseFloat(centre.y.toFixed(2));

        /** @type {UserTuple} */
        const userTuple = displayName ?
          [shortHandle, x, y, 0.5, displayName] :
          [shortHandle, x, y, 0.5];

        addedUsers[shortDID] = userTuple;

        console.log('        ' + shortHandle + ' placed near ' + Object.keys(knownUserNeighbours).length + ' neighbours  for [' + x + ',' + y + ']');

        /** @param {(string | null | undefined)[] | undefined} neighbours @param {number} coef */
        function addUserNeightbours(neighbours, coef) {
          if (!neighbours) return;

          for (const shortDID of neighbours) {
            if (!shortDID) continue;
            const neighbourTuple = hotUsers[shortDID];
            if (!neighbourTuple) continue;
            let matchTuple = knownUserNeighbours[shortDID];
            if (!matchTuple) {
              matchTuple = knownUserNeighbours[shortDID] = [...neighbourTuple];
            }
            matchTuple[3] *= (1 + coef);
          }
        }
      }


      function getDidHandle(shortDID) {
        return atClient.com.atproto.repo.describeRepo({ repo: unwrapShortDID(shortDID) }).then(x => shortenHandle(x.data.handle));
      }

      async function getDidDisplayName(shortDID) {
        try {
          const reply = await atClient.com.atproto.repo.listRecords({
            collection: 'app.bsky.actor.profile',
            repo: unwrapShortDID(shortDID)
          });
          const displayName = reply.data.records.map(rec => /** @type {*} */(rec.value).displayName).filter(d => d)[0];
          return displayName;
        } catch (error) {
          console.log('  ' + shortDID + ' no displayName: ' + error.message);
          return;
        }
      }

      async function getUserFollows(shortDID) {
        try {
          const reply = await atClient.com.atproto.repo.listRecords({
            collection: 'app.bsky.graph.follow',
            repo: unwrapShortDID(shortDID)
          });
          const followShortDIDs = reply.data.records.map(rec => shortenDID(/** @type {*} */(rec.value).subject));
          return followShortDIDs;
        } catch (error) {
          console.log('  ' + shortDID + ' no follows: ' + error.message);
          return;
        }
      }

      async function getUserLikes(shortDID) {
        try {
          const reply = await atClient.com.atproto.repo.listRecords({
            collection: 'app.bsky.feed.like',
            repo: unwrapShortDID(shortDID)
          });
          const likedDIDs = reply.data.records.map(rec => breakFeedUri(/** @type {*} */(rec.value).subject.uri)?.shortDID);
          return likedDIDs;
        } catch (error) {
          console.log('  ' + shortDID + ' no follows: ' + error.message);
          return;
        }
      }
    }
  }


  function debugDumpFirehose() {
    let likes = 0;
    let follows = 0;
    let posts = 0;
    let reposts = 0;
    let userMentions = {};
    let users = 0;
    const start = Date.now();
    let plusUsers = 0;
    let plusUsersLast = start;

    const { stop } = firehose({
      error: (err) => {
        console.log('firehose error', err);
        stop();
      },
      like: (who, whose, postID) => {
        likes++;
        mentionUser(who);
        mentionUser(whose);
        // console.log('like ' + who + ' ' + whose + ' ' + postID);
      },
      follow: (who, whom) => {
        follows++;
        // console.log('follow ' + who + ' ' + whom);
      },
      post: (author, postID, text, replyTo, replyToThread) => {
        posts++;
        // console.log('post ' + author + ' ' + postID + ' ' + text);
      },
      repost: (who, whose, postID) => {
        reposts++;
        // console.log('repost ' + who + ' ' + whose + ' ' + postID);
      }
    });

    setInterval(() => {
      const now = Date.now();
      const time = now - start;
      const total = likes + follows + posts + reposts;
      console.log(
        'likes ' + likes + ' (' + (likes / time * 1000).toFixed(2) + '/s)' +
        ',  follows ' + follows + ' (' + (follows / time * 1000).toFixed(2) + '/s)' +
        ',  posts ' + posts + ' (' + (posts / time * 1000).toFixed(2) + '/s)' +
        ',  reposts ' + reposts + ' (' + (reposts / time * 1000).toFixed(2) + '/s)' +
        ',  new posters +' + plusUsers + '/' + users + ' (' + (users / time * 1000).toFixed(2) + '/s)' +
        ',  total events ' + total + ' (' + (total / (now - plusUsersLast) * 1000).toFixed(2) + '/s)'
      );
      plusUsers = 0;
      plusUsersLast = now;
    }, 2000);

    function mentionUser(user) {
      if (userMentions[user]) return userMentions[user]++;

      userMentions[user] = 1;
      users++;
      plusUsers++;
    }

  }

  function cacheRequire(module) {
    const fromImports = /** @type {*} */(atlas).imports && /** @type {*} */(atlas).imports[module];
    if (fromImports) return fromImports;
    if (typeof require !== 'function') throw new Error('Unknown module ' + module);
    if (!/** @type {*} */(cacheRequire).imports)
      /** @type {*} */(cacheRequire).imports = require('./lib');

    const fromLib = /** @type {*} */(cacheRequire).imports[module] ||
      /** @type {*} */(global)?.imports &&
      /** @type {*} */(global).imports[module];

    if (fromLib) return fromLib;
    console.log('fallback for ' + JSON.stringify(module));
    return require(module);
  }

  // @ts-ignore
  atlas = function (invokeType) {
    if (typeof window !== 'undefined' && window && typeof window.alert === 'function')
      return runBrowser(invokeType);
    else if (typeof process !== 'undefined' && process && typeof process.stdout?.write === 'function')
      return runNode(invokeType);
  };
  atlas(invokeType);

} atlas('init');
