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

    const wsAddress =
      // bskyService.replace(/^(http|https)\:/, 'wss:') + 'com.atproto.sync.subscribeRepos';
      'wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos';
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
