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

  /** @typedef {[handle: string, x: number, y: number, weight: number, displayName?: string]} UserTuple */

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

  /** @type {typeof firehose} */
  function firehoseWithFallback(callbacks) {
    /** @type {ReturnType<typeof firehose> | undefined} */
    let fallbackHose;
    /** @type {ReturnType<typeof firehose> | undefined} */
    let websocketHose = firehose({
      ...callbacks,
      error: (errorWebSocket) => {
        websocketHose?.stop();
        websocketHose = undefined;
        fallbackHose = firehoseWithFallback.fallbackFirehose(callbacks);
      }
    });

    return { stop };

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
          firehoseJsonObj = loadRelativeScriptJsonp('../atlas-db-jsonp/firehose.js');
        }

        if (typeof firehoseJsonObj?.then === 'function') {
          firehoseJsonObj = await firehoseJsonObj;
        }
        let now = Date.now();

        let lastTimestamp = 0;
        for (const entry of firehoseJsonObj) {
          if (lastTimestamp)
            await new Promise(resolve => setTimeout(resolve, entry.timestamp - lastTimestamp));
          if (stopped) return;
          lastTimestamp = entry.timestamp;

          handleMessage(entry);
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

  /**
   * @param {string} relativePath
   * @returns {Promise<{}> | {}}
   */
  function loadRelativeScriptJsonp(relativePath) {
    const funcName = /** @type {string} */(relativePath.replace(/\.js$/, '').split('/').pop());
    if (typeof require === 'function' && typeof require.resolve === 'function') {
      const scriptText = require('fs').readFileSync(require('path').resolve(__dirname, relativePath), 'utf8');
      var fn = eval('function() { ' + scriptText + ' return ' + funcName + '; }');
      return fn();
    } else {
      return new Promise((resolve, reject) => {
        /** @type {*} */(window)[funcName] = (data) => {
          delete window[funcName];
          if (script.parentElement) script.parentElement.removeChild(script);
          resolve(data);
        };
        const script = document.createElement('script');
        script.onerror = (error) => {
          delete window[funcName];
          if (script.parentElement) script.parentElement.removeChild(script);
          reject(error);
        };
        script.onload = function () {
          setTimeout(() => {
            delete window[funcName];
            if (script.parentElement) script.parentElement.removeChild(script);
            reject(new Error('jsonp script loaded but no data received'));
          }, 300);
        };
        script.src = relativePath;
        document.body.appendChild(script);
      });
    }
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
    return handle.replace(_shortenHandle_Regex, '');
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
    const bounds = { x: { min: NaN, max: NaN }, y: { min: NaN, max: NaN } };
    for (const shortDID in users) {
      const [shortHandle, x, y] = users[shortDID];
      if (!Number.isFinite(bounds.x.min) || x < bounds.x.min) bounds.x.min = x;
      if (!Number.isFinite(bounds.x.max) || x > bounds.x.max) bounds.x.max = x;
      if (!Number.isFinite(bounds.y.min) || y < bounds.y.min) bounds.y.min = y;
      if (!Number.isFinite(bounds.y.max) || y > bounds.y.max) bounds.y.max = y;
    }
    return bounds;
  }

  /**
 * @param {number} x
 * @param {number} y
 * @param {{x: { min: number, max: number}, y: { min: number, max: number }}} bounds
 */
  function mapUserCoordsToAtlas(x, y, bounds) {
    const xRatiod = (x - bounds.x.min) / (bounds.x.max - bounds.x.min) - 0.5;
    const yRatiod = (y - bounds.y.min) / (bounds.y.max - bounds.y.min) - 0.5;
    const r = Math.sqrt(xRatiod * xRatiod + yRatiod * yRatiod);
    let h = (1 - r * r) * 0.3 - 0.265;
    return { x: xRatiod, h, y: -yRatiod };
  }


  /**
   * @param {{ [shortDID: string]: UserTuple}} users
   * @param {number} tileAxisCount
   */
  function makeProximityTiles(users, tileAxisCount) {
    // break users into tileAxisCount x tileAxisCount tiles
    const bounds = getUserCoordBounds(users);
    /** @type {string[][]} */
    const tiles = [];
    for (const shortDID in users) {
      const [, x, y] = users[shortDID];
      const xTileIndex = Math.floor((x - bounds.x.min) / (bounds.x.max - bounds.x.min) * tileAxisCount);
      const yTileIndex = Math.floor((y - bounds.y.min) / (bounds.y.max - bounds.y.min) * tileAxisCount);
      const tileIndex = xTileIndex + yTileIndex * tileAxisCount;
      const tile = tiles[tileIndex];
      if (!tile) tiles[tileIndex] = [shortDID];
      else tile.push(shortDID);
    }

    return { tiles, findTiles, tileIndexXY };

    /**
     * @param {number} x
     * @param {number} y
     * @param {(shortDID: string, usrTuple: UserTuple) => boolean | null | undefined} check
     * @returns {[xLowIndex: number, xHighIndex: number, yLowIndex: number, yHighIndex: number]}
     */
    function findTiles(x, y, check) {
      const xCenterIndex = Math.floor((x - bounds.x.min) / (bounds.x.max - bounds.x.min) * tileAxisCount);
      const yCenterIndex = Math.floor((y - bounds.y.min) / (bounds.y.max - bounds.y.min) * tileAxisCount);
      const tileIndex = xCenterIndex + yCenterIndex * tileAxisCount;

      /** @type {string} */
      let shortDID;

      let xLowIndex = Math.max(0, xCenterIndex - 1);
      while ((xLowIndex - 1) > 0 && check(shortDID = tiles[tileIndexXY(xLowIndex, yCenterIndex)]?.[0], users[shortDID])) xLowIndex--;
      let xHighIndex = Math.min(tileAxisCount - 1, xCenterIndex + 1);
      while ((xHighIndex + 1) < tileAxisCount && check(shortDID = tiles[tileIndexXY(xHighIndex, yCenterIndex)]?.[0], users[shortDID])) xHighIndex++;
      let yLowIndex = Math.max(0, yCenterIndex - 1);
      while ((yLowIndex - 1) > 0 && check(shortDID = tiles[tileIndexXY(xCenterIndex, yLowIndex)]?.[0], users[shortDID])) yLowIndex--;
      let yHighIndex = Math.min(tileAxisCount - 1, yCenterIndex + 1);
      while ((yHighIndex + 1) < tileAxisCount && check(shortDID = tiles[tileIndexXY(xCenterIndex, yHighIndex)]?.[0], users[shortDID])) yHighIndex++;

      return [xLowIndex, xHighIndex, yLowIndex, yHighIndex];
    }

    /**
     * @param {number} xTileIndex
     * @param {number} yTileIndex
     */
    function tileIndexXY(xTileIndex, yTileIndex) {
      return xTileIndex + yTileIndex * tileAxisCount;
    }
  }

  async function runBrowser(invokeType) {
    const users = await boot();
    /** @type {typeof import('three')} */
    const THREE = /** @type {*} */(atlas).imports['three'];
    const Stats = /** @type {*} */(atlas).imports['three/addons/libs/stats.module.js'];
    const OrbitControls = /** @type {*} */(atlas).imports['three/addons/controls/OrbitControls.js'];

    console.log('Users: ', typeof users, Object.keys(users).length);
    threedshell();

    async function boot() {
      const INIT_UI_FADE_MSEC = 2000;
        // @ts-ignore
      const waitForRunBrowserNext = new Promise(resolve => runBrowser = resolve);

        // @ts-ignore
      let waitForUsersLoaded = new Promise((resolve, reject) => typeof hot !== 'undefined' ? resolve(hot) :
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

      /** @type {{ [shortDID: string]: UserTuple}} */
      const users = await waitForUsersLoaded;
      return users;

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

    async function threedshell() {
      const {
        scene,
        camera,
        lights,
        renderer,
        stats,
        clock,
        controls,
        updateCamera,
        userBounds
      } = setupScene();

      const domElements = appendToDOM();
      handleWindowResizes();

      //const shaderState = webgl_buffergeometry_instancing_demo();

      const fh = trackFirehose(userBounds);
      scene.add(fh.mesh);

      startAnimation();

      /** @param {string} shortDID */
      function defaultUserColorer(shortDID) {
        /** @type {THREE.Color} */
        let rgb;
        if (!/** @type {*} */(defaultUserColorer).rgb) /** @type {*} */(defaultUserColorer).rgb = rgb = new THREE.Color();
        else (rgb = /** @type {*} */(defaultUserColorer).rgb).set(0, 0, 0);

        const crc32 = calcCRC32(shortDID);
        const hue = (Math.abs(crc32) % 2000) / 2000;
        rgb.offsetHSL(hue, 3, 0.6);
        const hexColor = rgb.getHex() * 256 + 0xFF;
        return hexColor;
      }

      function setupScene() {
        const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.00001, 10000);
        camera.position.x = 0.18;
        camera.position.y = 0.49;
        camera.position.z = 0.88;

        const scene = new THREE.Scene();

        const dirLight1 = new THREE.DirectionalLight(0xffffff, 5);
        dirLight1.position.set(3000, 1500, -3000);
        scene.add(dirLight1);

        const dirLight2 = new THREE.DirectionalLight(0xffffff, 5);
        dirLight2.position.set(-3000, 1500, -3000);
        scene.add(dirLight2);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
        scene.add(ambientLight);

        const renderer = new THREE.WebGLRenderer();
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);

        const stats = new Stats();

        const controls = new OrbitControls(camera, document.body);
        controls.maxDistance = 40 * 1000;
        controls.enableDamping = true;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.2;
        controls.listenToKeyEvents(window);

        scene.add(new THREE.AxesHelper(1000));

        const userBounds = getUserCoordBounds(users);
        const proximityTiles = makeProximityTiles(users, 16);

        const farUsersMesh = createFarUsersMesh();

        return {
          scene,
          camera,
          lights: { dirLight1, dirLight2, ambientLight },
          renderer,
          stats,
          userBounds,
          farUsersMesh,
          proximityTiles,
          controls
        };

        function createFarUsersMesh() {
          const { mesh } = billboardShaderRenderer({
            fragmentShader: `
            `,
            userKeys: Object.keys(users),
            userMapper: (shortDID, pos) => {
              const [, xSpace, ySpace] = users[shortDID];
              const { x, y, h } = mapUserCoordsToAtlas(xSpace, ySpace, userBounds);
              pos[0] = x;
              pos[1] = h;
              pos[2] = y;
              pos[3] = 0.001;
            },
            userColorer: defaultUserColorer
          })
          scene.add(mesh);
          return mesh;
        }
      }

      /** @param {{x: { min: number, max: number}, y: { min: number, max: number }}} bounds */
      function trackFirehose(bounds) {

        const MAX_WEIGHT = 0.1;
        const FADE_TIME_MSEC = 2000;
        /** @type {{ [shortDID: string]: { x: number, y: number, h: number, weight: number, color: number, startAtMsec: number, fadeAtMsec: number } }} */
        const activeUsers = {};
        const rend = flashesRenderer();
        let updateUsers = false;

        firehoseWithFallback({
          post(author, postID, text, replyTo, replyToThread, timeMsec) {
            addActiveUser(author, 1, timeMsec);
          },
          repost(who, whose, postID, timeMsec) {
            addActiveUser(who, 0.6, timeMsec);
            addActiveUser(whose, 0.7, timeMsec);
          },
          like(who, whose, postID, timeMsec) {
            addActiveUser(who, 0.1, timeMsec);
            addActiveUser(whose, 0.4, timeMsec);
          },
          follow(who, whom, timeMsec) {
            addActiveUser(who, 0.1, timeMsec);
            addActiveUser(whom, 1.5, timeMsec);
          }
        });

        return {
          mesh: rend.mesh,
          tickAll
        };

        function flashesRenderer() {
          const rend = billboardShaderRenderer({
            fragmentShader: `
            gl_FragColor = tintColor;
            gl_FragColor.a = gl_FragColor.a * gl_FragColor.a; //(timeRatio < 0.2 ? timeRatio * 5.0 : 1.0);
            gl_FragColor.a = gl_FragColor.a * gl_FragColor.a;
            gl_FragColor.a = gl_FragColor.a * gl_FragColor.a;
            `,
            userKeys: Object.keys(users).slice(0, 10* 1000),
            userMapper: (shortDID, pos) => {
              const usr = activeUsers[shortDID];
              if (!usr) return;
              pos[0] = usr.x;
              pos[1] = usr.h;
              pos[2] = usr.y;
              pos[3] = usr.weight;
              pos[4] = usr.startAtMsec;
              pos[5] = usr.fadeAtMsec;
            },
            userColorer: (shortDID) => activeUsers[shortDID]?.color
          });
          return rend;
        }

        /** @param {number} timePassedSec */
        function tickAll(timePassedSec) {
          const current = Date.now();
          for (const shortDID in activeUsers) {
            const ball = activeUsers[shortDID];
            if (ball.fadeAtMsec < current) {
              delete activeUsers[shortDID];
              updateUsers = true;
            } 
          }

          if (updateUsers) {
            rend.updateUserSet(Object.keys(activeUsers));
            updateUsers = false;
          }
        }

        /**
         * @param {string} shortDID
         * @param {number} weight
         * @param {number} timestampMsec
         */
        function addActiveUser(shortDID, weight, timestampMsec) {
          let existingUser = activeUsers[shortDID];
          if (existingUser) {
            updateUsers = true;
            existingUser.weight = Math.min(MAX_WEIGHT, weight * 0.1 + existingUser.weight);
            existingUser.fadeAtMsec = timestampMsec + FADE_TIME_MSEC;
            return;
          }

          const usrTuple = users[shortDID];
          if (!usrTuple) return;
          const { x, y, h } = mapUserCoordsToAtlas(usrTuple[1], usrTuple[2], userBounds);
          const color = defaultUserColorer(shortDID);

          activeUsers[shortDID] = { x, y, h, weight: weight * 0.1, color, startAtMsec: timestampMsec, fadeAtMsec: timestampMsec + FADE_TIME_MSEC };
          updateUsers = true;
        }
      }

      function appendToDOM() {
        const root = elem('div', { parent: document.body, style: 'position: fixed; left: 0; top: 0; width: 100%; height: 100%;' });
        renderer.domElement.style.cssText = `
        position: fixed;
        left: 0; top: 0; width: 100%; height: 100%;
        `;
        renderer.domElement.className = 'atlas-3d';
        root.appendChild(renderer.domElement);
        stats.domElement.style.position = 'relative';
        stats.domElement.style.pointerEvents = 'all';

        let title, rightStatus;
        const titleBar = elem('div', {
          style: ` position: fixed; left: 0; top: 0; width: 100%; height: auto; background: rgba(0,0,0,0.5); color: gold; display: grid; grid-template-rows: auto; grid-template-columns: auto 1fr auto; max-height: 5em; pointer-events: none;`,
          parent: root,
          children: [
            stats.domElement,
            title = elem('h3', { textContent: 'Atlas 3D', style: 'text-align: center; font-weight: 100; margin-left: -29px' }),
            rightStatus = elem('div', { innerHTML: String(Object.keys(users).length) + '<br>users', fontSize: '80%', alignSelf: 'center', paddingRight: '1em', textAlign: 'center' })
          ]
        });

        return { root, titleBar, title, rightStatus };
      }

      function handleWindowResizes() {
        window.addEventListener('resize', onWindowResize);

        function onWindowResize() {
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(window.innerWidth, window.innerHeight);
        }
      }

      function startAnimation() {

        requestAnimationFrame(continueAnimating);

        function continueAnimating() {
          requestAnimationFrame(continueAnimating);
          renderFrame();
        }

        let cameraStatus;
        let lastCameraUpdate;
        let lastRender;
        function renderFrame() {
          const now = Date.now();
          let rareMoved = false;
          if (!cameraStatus || !(now < lastCameraUpdate + 200)) {
            lastCameraUpdate = now;
            if (!cameraStatus) cameraStatus = {
              elem: elem('div', { parent: domElements.rightStatus, fontSize: '80%', opacity: '0.7' }),
              lastPos: { x: NaN, y: NaN, z: NaN }
            };

            const dist = Math.sqrt(
              (camera.position.x - cameraStatus.lastPos.x) * (camera.position.x - cameraStatus.lastPos.x) +
              (camera.position.y - cameraStatus.lastPos.y) * (camera.position.y - cameraStatus.lastPos.y) +
              (camera.position.z - cameraStatus.lastPos.z) * (camera.position.z - cameraStatus.lastPos.z));
            
            if (!(dist < 0.0001)) rareMoved = true;
          }

          stats.begin();
          const delta = lastRender ? now - lastRender : 0;
          lastRender = now;
          controls.update(delta / 1000);
          fh.tickAll(delta / 1000);
          // shaderState.updateOnFrame(rareMoved);

          renderer.render(scene, camera);
          stats.end();

          if (rareMoved) {
            cameraStatus.lastPos.x = camera.position.x;
            cameraStatus.lastPos.y = camera.position.y;
            cameraStatus.lastPos.z = camera.position.z;
            cameraStatus.elem.textContent = camera.position.x.toFixed(2) + ', ' + camera.position.y.toFixed(2) + ', ' + camera.position.z.toFixed(2);

            //updateCamera(camera.position);
          }
        }
      }

      /**
       * @param {THREE.BufferGeometry} geometry
       */
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
       *  userKeys: K[];
       *  userMapper(i: K, pos: [x: number, y: number, z: number, diameter: number, startMsec: number, stopMsec: number]): void;
       *  userColorer(i: K): number;
       *  fragmentShader: string;
       * }} _ 
       * @template K
       */
      function billboardShaderRenderer({ userKeys, userMapper, userColorer, fragmentShader }) {
        const startTime = Date.now();
        const baseHalf = 1.5 * Math.tan(Math.PI / 6);
        let positions = new Float32Array([
          -baseHalf, 0, -0.5,
          0, 0, 1,
          baseHalf, 0, -0.5
        ]);
        let userOffsets = new Float32Array(userKeys.length * 3);
        let userSizes = new Float32Array(userKeys.length);
        let userStartMsec = new Float32Array(userKeys.length);
        let userStopMsec = new Float32Array(userKeys.length);
        let userColors = new Uint32Array(userKeys.length);
        let offsetsChanged = false;
        let sizesChanged = false;
        let colorsChanged = false;
        let startMsecChanged = false;
        let stopMsecChanged = false;

        populateAttributes(userKeys);

        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.InstancedBufferAttribute(userSizes, 1));
        geometry.setAttribute('userStartMsec', new THREE.InstancedBufferAttribute(userStartMsec, 1));
        geometry.setAttribute('userStopMsec', new THREE.InstancedBufferAttribute(userStopMsec, 1));
        geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(userOffsets, 3));
        geometry.setAttribute('color', new THREE.InstancedBufferAttribute(userColors, 1));

        const material = new THREE.ShaderMaterial({
          uniforms: {
            timeMsec: { value: Date.now() }
          },
          vertexShader: `
            precision highp float;

            attribute vec3 offset;
            attribute float size;
            attribute float userStartMsec;
            attribute float userStopMsec;
            attribute uint color;
            attribute float timeMsec;

            varying vec3 vPosition;
            varying float vFogDist;
            varying vec4 vColor;
            varying float vSize;
            varying float vUserStartMsec;
            varying float vUserStopMsec;
            varying float vTimeMsec;

            void main(){
              // multiply position.xy by size to scale the billboard
              gl_Position = projectionMatrix * (modelViewMatrix * vec4(offset, 1) + vec4(position.xz * size, 0, 0));

              vPosition = position;
              vSize = size;
              vUserStartMsec = userStartMsec;
              vUserStopMsec = userStopMsec;
              vTimeMsec = timeMsec;

              uint rInt = (color / uint(256 * 256 * 256)) % uint(256);
              uint gInt = (color / uint(256 * 256)) % uint(256);
              uint bInt = (color / uint(256)) % uint(256);
              uint aInt = (color) % uint(256);

              // https://stackoverflow.com/a/22899161/140739
              vColor = vec4(0);
              vColor.r = float(rInt) / 255.0f;
              vColor.g = float(gInt) / 255.0f;
              vColor.b = float(bInt) / 255.0f;
              vColor.a = float(aInt) / 255.0f;

              vFogDist = distance(cameraPosition, offset);
            }
          `,
          fragmentShader: `
            precision highp float;

            varying vec3 vPosition;
            varying vec4 vColor;
            varying float vFogDist;
            varying float vSize;
            varying float vUserStartMsec;
            varying float vUserStopMsec;
            varying float vTimeMsec;

            void main() {
              gl_FragColor = vColor;
              float dist = distance(vPosition, vec3(0.0));
              float rad = 0.25;
              float areola = rad * 2.0;
              float bodyRatio =
                dist < rad ? 1.0 :
                dist > areola ? 0.0 :
                (areola - dist) / (areola - rad);
              float radiusRatio =
                dist < 0.5 ? 1.0 - dist * 2.0 : 0.0;

              float fogStart = 0.5;
              float fogGray = 1.0;
              float fogRatio = vFogDist < fogStart ? 0.0 : vFogDist > fogGray ? 1.0 : (vFogDist - fogStart) / (fogGray - fogStart);

              vec4 tintColor = vColor;
              tintColor.a = radiusRatio;
              gl_FragColor = mix(gl_FragColor, vec4(1,1,1,0.7), fogRatio);
              gl_FragColor.a = bodyRatio;

              float timeRatio = (vTimeMsec - vUserStartMsec) / (vUserStopMsec - vUserStartMsec);

              ${fragmentShader}
            }
          `,
          side: THREE.BackSide,
          // forceSinglePass: true,
          transparent: true,
          depthWrite: false
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.onBeforeRender = () => {
          material.uniforms['timeMsec'].value = Date.now() - startTime;
        };
        return { mesh, updateUserSet };

        /**
         * @param {Parameters<typeof userColorer>[0][]} userKeys
         */
        function populateAttributes(userKeys) {
          /** @type {[x: number, y: number, z: number, size: number, startMsec: number, stopMsec: number]} */
          const userPos = [NaN, NaN, NaN, NaN, NaN, NaN];

          for (let i = 0; i < userKeys.length; i++) {
            const user = userKeys[i];
            userPos[0] = userPos[1] = userPos[2] = userPos[3] = userPos[4] = userPos[5] = NaN;
            userMapper(user, userPos);
            const oldX = userOffsets[i * 3 + 0];
            const oldY = userOffsets[i * 3 + 1];
            const oldZ = userOffsets[i * 3 + 2];
            const oldSize = userSizes[i];
            const oldStartMsec = userStartMsec[i];
            const oldStopMsec = userStopMsec[i];
            const oldColor = userColors[i];

            userOffsets[i * 3 + 0] = userPos[0];
            userOffsets[i * 3 + 1] = userPos[1];
            userOffsets[i * 3 + 2] = userPos[2];
            userSizes[i] = userPos[3];
            userColors[i] = userColorer(user);
            userStartMsec[i] = userPos[4] - startTime;
            userStopMsec[i] = userPos[5] - startTime;

            if (userOffsets[i * 3 + 0] !== oldX || userOffsets[i * 3 + 1] !== oldY || userOffsets[i * 3 + 2] !== oldZ)
              offsetsChanged = true;
            if (userSizes[i] !== oldSize)
              sizesChanged = true;
            if (userStartMsec[i] != oldStartMsec)
              startMsecChanged = true;
            if (userStopMsec[i] != oldStopMsec)
              stopMsecChanged = true;
            if (userColors[i] !== oldColor)
              colorsChanged = true;
          }
        }

        /**
         * @param {Parameters<typeof userColorer>[0][]} userKeys
         */
        function updateUserSet(userKeys) {
          if (userKeys.length > userColors.length) {
            const newSize = Math.max(userColors.length * 2, userKeys.length);
            userOffsets = new Float32Array(newSize * 3);
            userSizes = new Float32Array(newSize);
            userColors = new Uint32Array(userKeys.length);

            geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(userOffsets, 3));
            geometry.attributes['offset'].needsUpdate = true;
            geometry.setAttribute('color', new THREE.InstancedBufferAttribute(userColors, 1));
            geometry.attributes['color'].needsUpdate = true;
            geometry.setAttribute('size', new THREE.InstancedBufferAttribute(userSizes, 1));
            geometry.attributes['size'].needsUpdate = true;
            geometry.setAttribute('userStartMsec', new THREE.InstancedBufferAttribute(userStartMsec, 1));
            geometry.attributes['userStartMsec'].needsUpdate = true;
            geometry.setAttribute('userStopMsec', new THREE.InstancedBufferAttribute(userStopMsec, 1));
            geometry.attributes['userStopMsec'].needsUpdate = true;
          }

          populateAttributes(userKeys);
          if (offsetsChanged) geometry.attributes['offset'].needsUpdate = true;
          if (sizesChanged) geometry.attributes['size'].needsUpdate = true;
          if (colorsChanged) geometry.attributes['color'].needsUpdate = true;
          if (startMsecChanged) geometry.attributes['userStartMsec'].needsUpdate = true;
          if (stopMsecChanged) geometry.attributes['userStopMsec'].needsUpdate = true;

          offsetsChanged = sizesChanged = colorsChanged = false;

          geometry.instanceCount = userKeys.length;
        }
      }
    }

    /**
     * @param {TagName} tagName
     * @param {(Omit<Partial<HTMLElement['style']> & Partial<HTMLElement>, 'children' | 'parent' | 'parentElement' | 'style'> & { children?: (Element | string | null | void | undefined)[], parent?: Element | null, parentElement?: Element | null, style?: string | Partial<HTMLElement['style']>  })=} [style]
     * @returns {HTMLElementTagNameMap[TagName]}
     * @template {string} TagName
     */
    function elem(tagName, style) {
      const el = document.createElement(tagName);

      if (style && typeof style.appendChild === 'function') {
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
          if (key === 'parent' || key === 'parentElement')
            setParent = /** @type {*} */(style[key]);
          else if (key === 'children')
            appendChildren = /** @type {*} */(style[key]);
          else if (style[key] == null || typeof style[key] === 'function') continue;
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

    debugDumpFirehose();
  }


  function getMassCenter(users) {
    let xTotal = 0, yTotal = 0, count = 0;
    for (const shortDID in users) {
      const usrTuple = users[shortDID];
      if (!Array.isArray(usrTuple)) continue;
      const x = usrTuple[1];
      const y = usrTuple[2];

      count++;
      xTotal += x;
      yTotal += y;
    }
    return { x: xTotal / count, y: yTotal / count };
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
