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
    let websocketLikesProcessed = 0;
    /** @type {ReturnType<typeof firehose> | undefined} */
    let fallbackHose;
    /** @type {ReturnType<typeof firehose> | undefined} */
    let websocketHose = startWebsocketHose();

    return { stop };

    function startWebsocketHose() {
      return firehose({
        like: (who, whose, postID, timeMsec) => {
          const result = callbacks.like?.(who, whose, postID, timeMsec);
          websocketLikesProcessed++;
          return result;
        },
        ...callbacks,
        error: (errorWebSocket) => {
          if (websocketLikesProcessed) {
            websocketHose?.stop();
            websocketHose = undefined;
            setTimeout(() => {
              websocketHose = startWebsocketHose();
            }, 400 + Math.random() * 500);
          } else {
            websocketHose?.stop();
            websocketHose = undefined;
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
    /** @type {typeof import('troika-three-text')} */
    const troika_three_text = /** @type {*} */(atlas).imports['troika-three-text'];

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
      const worldStartTime = Date.now();

      const {
        scene,
        camera,
        lights,
        renderer,
        stats,
        clock,
        updateCamera,
        userBounds
      } = setupScene();

      const domElements = appendToDOM();
      const orbit = setupOrbitControls(camera);
      if (location.hash?.length > 3) {
        const hasCommaParts = location.hash.replace(/^#/, '').split(',');
        if (hasCommaParts.length === 3) {
          const [cameraX, cameraY, cameraZ] = hasCommaParts.map(parseFloat);
          camera.position.set(cameraX, cameraY, cameraZ);
        }
      }

      handleWindowResizes();
      handleTouch(document.body, (xy) => {
        console.log('touch ', xy);
      });

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

        const dirLight1 = new THREE.DirectionalLight(0xffffff, 7);
        dirLight1.position.set(0.5, 1, -0.5);
        scene.add(dirLight1);

        const dirLight2 = new THREE.DirectionalLight(0xffffff, 2);
        dirLight2.position.set(-0.5, -0.5, 0.5);
        scene.add(dirLight2);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        scene.add(ambientLight);

        const renderer = new THREE.WebGLRenderer();
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);

        const stats = new Stats();

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
          proximityTiles
        };

        function createFarUsersMesh() {
          const { mesh } = billboardShaderRenderer({
            fragmentShader: `
            `,
            userKeys: Object.keys(users),
            userMapper: (shortDID, pos) => {
              const [, xSpace, ySpace, weight] = users[shortDID];
              const { x, y, h } = mapUserCoordsToAtlas(xSpace, ySpace, userBounds);
              pos.set(x, h, y, weight ? 0.001 : -0.001);
            },
            userColorer: defaultUserColorer
          })
          scene.add(mesh);
          return mesh;
        }
      }

      /**
       * @param {THREE.Camera} camera
       */
      function setupOrbitControls(camera) {
        const STEADY_ROTATION_SPEED = 0.2;

        const controls = new OrbitControls(camera, renderer.domElement);
        let autorotateTimeout1, autorotateTimeout2, autorotateTimeout3;
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
        controls.listenToKeyEvents(window);

        return {
          controls,
          pauseRotation,
          waitAndResumeRotation,
          moveAndPauseRotation
        };

        var changingRotationInterval;

        function pauseRotation() {
          controls.autoRotate = false;
          clearInterval(changingRotationInterval);
        }

        function waitAndResumeRotation(resumeAfterWait) {
          const WAIT_BEFORE_RESUMING_MSEC = 10000;
          const SPEED_UP_WITHIN_MSEC = 10000;

          if (!resumeAfterWait) resumeAfterWait = WAIT_BEFORE_RESUMING_MSEC;

          clearInterval(changingRotationInterval);
          const startResumingRotation = Date.now();
          changingRotationInterval = setInterval(continueResumingRotation, 100);

          controls.autoRotateSpeed = 0.0001;
          controls.autoRotate = true;

          function continueResumingRotation() {
            const passedTime = Date.now() - startResumingRotation;
            if (passedTime < resumeAfterWait) return;
            if (passedTime > resumeAfterWait + SPEED_UP_WITHIN_MSEC) {
              controls.autoRotateSpeed = STEADY_ROTATION_SPEED;
              controls.autoRotate = true;
              clearInterval(changingRotationInterval);
              return;
            }

            const phase = (passedTime - resumeAfterWait) / SPEED_UP_WITHIN_MSEC;
            controls.autoRotateSpeed = 0.2 * dampenPhase(phase);
          }
        }

        /** @param {{x: number, y: number, h: number }} xyh */
        function moveAndPauseRotation(xyh) {
          const MOVE_WITHIN_MSEC = 6000;
          const WAIT_AFTER_MOVEMENT_BEFORE_RESUMING_ROTATION_MSEC = 30000;
          const MIDDLE_AT_PHASE = 0.6;
          const RAISE_MIDDLE_WITH = 0.25;

          pauseRotation();
          const startMoving = Date.now();
          const startCameraPosition = camera.position.clone();

          const r = Math.sqrt(xyh.x * xyh.x + xyh.y * xyh.y);
          const angle = Math.atan2(xyh.y, xyh.x);
          const xMiddle = (r + 0.6) * Math.cos(angle);
          const yMiddle = (r + 0.6) * Math.sin(angle);
          const hMiddle = xyh.h + RAISE_MIDDLE_WITH;

          changingRotationInterval = setInterval(continueMoving, 10);

          function continueMoving() {

            const passedTime = Date.now() - startMoving;
            if (passedTime > MOVE_WITHIN_MSEC) {
              clearInterval(changingRotationInterval);
              waitAndResumeRotation(WAIT_AFTER_MOVEMENT_BEFORE_RESUMING_ROTATION_MSEC);
              // controls.target.set(xyh.x, xyh.h, xyh.y);
              return;
            }

            const phase = passedTime / MOVE_WITHIN_MSEC;

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

      /** @param {{x: { min: number, max: number}, y: { min: number, max: number }}} bounds */
      function trackFirehose(bounds) {

        const MAX_WEIGHT = 0.1;
        const FADE_TIME_MSEC = 4000;
        /** @type {{ [shortDID: string]: { x: number, y: number, h: number, weight: number, color: number, startAtMsec: number, fadeAtMsec: number } }} */
        const activeUsers = {};
        const rend = flashesRenderer();
        let updateUsers = false;

        const unknownsLastSet = new Set();
        const unknownsTotalSet = new Set();

        firehoseWithFallback({
          post(author, postID, text, replyTo, replyToThread, timeMsec) {
            addActiveUser(author, 1, timeMsec);
            replyTo?.shortDID ? addActiveUser(replyTo.shortDID, 1, timeMsec) : undefined;
            replyToThread?.shortDID ? addActiveUser(replyToThread.shortDID, 0.5, timeMsec) : undefined;
            outcome.posts++;
          },
          repost(who, whose, postID, timeMsec) {
            addActiveUser(who, 0.6, timeMsec);
            addActiveUser(whose, 0.7, timeMsec);
            outcome.reposts++;
          },
          like(who, whose, postID, timeMsec) {
            addActiveUser(who, 0.1, timeMsec);
            addActiveUser(whose, 0.4, timeMsec);
            outcome.likes++;
          },
          follow(who, whom, timeMsec) {
            addActiveUser(who, 0.1, timeMsec);
            addActiveUser(whom, 1.5, timeMsec);
            outcome.follows++;
          }
        });

        const outcome = {
          posts: 0,
          reposts: 0,
          likes: 0,
          follows: 0,
          unknowns: 0,
          unknownsTotal: 0,
          mesh: rend.mesh,
          tickAll
        };

        return outcome;

        function flashesRenderer() {
          const rend = billboardShaderRenderer({
            vertexShader: /* glsl */`
            float startTime = min(extra.x, extra.y);
            float endTime = max(extra.x, extra.y);
            float timeRatio = (time - startTime) / (endTime - startTime);
            float step = 0.1;
            float timeFunction = timeRatio < step ? timeRatio / step : 1.0 - (timeRatio - step) * (1.0 - step);

            gl_Position.y += timeFunction * timeFunction * timeFunction * 0.01;
            `,
            fragmentShader: /* glsl */`
            gl_FragColor = tintColor;

            float startTime = min(extra.x, extra.y);
            float endTime = max(extra.x, extra.y);
            float timeRatio = (time - startTime) / (endTime - startTime);
            float step = 0.1;
            float timeFunction = timeRatio < step ? timeRatio / step : 1.0 - (timeRatio - step) * (1.0 - step);

            gl_FragColor = tintColor;

            gl_FragColor.a *= timeFunction * timeFunction * timeFunction;

            // gl_FragColor =
            //   timeRatio > 1000.0 ? vec4(1.0, 0.7, 1.0, tintColor.a) :
            //   timeRatio > 1.0 ? vec4(1.0, 0.0, 1.0, tintColor.a) :
            //   timeRatio > 0.0 ? vec4(0.0, 0.5, 0.5, tintColor.a) :
            //   timeRatio == 0.0 ? vec4(0.0, 0.0, 1.0, tintColor.a) :
            //   timeRatio < 0.0 ? vec4(1.0, 0.0, 0.0, tintColor.a) :
            //   vec4(1.0, 1.0, 0.0, tintColor.a);

            float diagBias = 1.0 - max(abs(vPosition.x), abs(vPosition.z));
            float diagBiasUltra = diagBias * diagBias * diagBias * diagBias;
            gl_FragColor.a *= diagBiasUltra * diagBiasUltra * diagBiasUltra * diagBiasUltra;

            `,
            userKeys: Object.keys(users).slice(0, 10* 1000),
            userMapper: (shortDID, pos, extra) => {
              const usr = activeUsers[shortDID];
              if (!usr) return;
              pos.set(usr.x, usr.h, usr.y, usr.weight);
              extra.x = (usr.startAtMsec - worldStartTime) / 1000;
              extra.y = (usr.fadeAtMsec - worldStartTime) / 1000;
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
         * @param {number} _unused
         */
        function addActiveUser(shortDID, weight, _unused) {
          const now = Date.now();
          let existingUser = activeUsers[shortDID];
          if (existingUser) {
            updateUsers = true;
            existingUser.weight = Math.min(MAX_WEIGHT, weight * 0.2 + existingUser.weight);
            existingUser.fadeAtMsec = now + FADE_TIME_MSEC;
            return 2;
          }

          const usrTuple = users[shortDID];
          if (!usrTuple) {
            if (!outcome.unknowns && unknownsLastSet.size)
              unknownsLastSet.clear();
            unknownsLastSet.add(shortDID);
            unknownsTotalSet.add(shortDID);
            outcome.unknowns = unknownsLastSet.size;
            outcome.unknownsTotal = unknownsTotalSet.size;
            return;
          }

          const { x, y, h } = mapUserCoordsToAtlas(usrTuple[1], usrTuple[2], userBounds);
          const color = defaultUserColorer(shortDID);

          activeUsers[shortDID] = { x, y, h, weight: weight * 0.2, color, startAtMsec: now, fadeAtMsec: now + FADE_TIME_MSEC };
          updateUsers = true;
          return 1;
        }
      }

      function appendToDOM() {
        let title, titleBar, subtitleArea, rightStatus, searchMode, bottomStatusLine;
        const root = elem('div', {
          parent: document.body,
          style: `
          position: fixed; left: 0; top: 0; width: 100%; height: 100%;
          display: grid; grid-template-rows: auto auto 1fr auto; grid-template-columns: 1fr;
          `,
          children: [
            renderer.domElement,
            titleBar = elem('div', {
              style: `
              background: rgba(0,0,0,0.5); color: gold;
              display: grid; grid-template-rows: auto; grid-template-columns: auto 1fr auto;
              z-index: 10;
              max-height: 5em;`,
              onclick: () => { if (!searchMode) switchToSearch(); },
              children: [
                stats.domElement,
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
        renderer.domElement.style.cssText = `
        position: fixed;
        left: 0; top: 0; width: 100%; height: 100%;
        `;
        renderer.domElement.className = 'atlas-3d';
        stats.domElement.style.position = 'relative';

        const status = createStatusRenderer(rightStatus);
        return { root, titleBar, subtitleArea, title, rightStatus, status, bottomStatusLine };

        /** @param {HTMLElement} rightStatus */
        function createStatusRenderer(rightStatus) {
          let cameraPos, cameraMovementIcon;

          const usersCountStr = Object.keys(users).length.toString();
          elem('div', {
            parent: rightStatus,
            children: [
              elem('div', {
                innerHTML:
                  usersCountStr.slice(0, 3) +
                  '<span style="display: inline-block; width: 0.1em;"></span>' +
                  usersCountStr.slice(3)
              }),
              elem('div', { innerHTML: 'users' }),
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

          function update() {
            cameraPos.textContent =
              camera.position.x.toFixed(2) + ', ' + camera.position.y.toFixed(2) + ', ' + camera.position.z.toFixed(2);
            cameraMovementIcon.textContent = orbit.controls.autoRotate ? '>' : '||';
            cameraStatusLine.style.opacity = orbit.controls.autoRotate ? '0.4' : '0.7';
          }
        }

        function createBottomStatusLine() {
          let likesElem, postsElem, repostsElem, followsElem, unknownsPerSecElem, unknownsTotalElem;

          const bottomStatusLine = /** @type {HTMLDivElement & { update(outcome) }} */(elem('div', {
            style: `
                grid-row: 5;
                color: #cc903b;
                z-index: 10;
                font-size: 80%;
                text-shadow: 6px -2px 7px black, -3px -6px 7px black, 5px 4px 7px black;
                padding: 0.25em;
                padding-right: 0.5em;
                text-align: right;
                line-height: 1.5;`,
            children: [
              elem('div', {
                children: [elem('a', {
                  href: 'https://bsky.app/profile/oyin.bo', innerHTML: 'created by <b>@oyin.bo</b>',
                  style: 'color: gray; text-decoration: none; font-weight: 100;'
                })]
              }),
              elem('div', {
                children: [elem('a', {
                  href: 'https://bsky.jazco.dev/', innerHTML: 'exploiting geo-spatial data from <b>@jaz.bsky.social</b>',
                  style: 'color: gray; text-decoration: none; font-weight: 100;'
                })]
              }),
              elem('div', { height: '0.5em'}),
              'posts+',
              postsElem = elem('span', { color: 'gold' }),
              ' ♡+',
              likesElem = elem('span', { color: 'gold' }),
              ' RT+',
              repostsElem = elem('span', { color: 'gold' }),
              ' follows+',
              followsElem = elem('span', { color: 'gold' }),
              ' ',
              elem('span', { textContent: 'unknown users: +', color: '#1ca1a1' }),
              unknownsPerSecElem = elem('span', { color: 'cyan' }),
              elem('span', { textContent: '/', color: '#1ca1a1' }),
              unknownsTotalElem = elem('span', { color: 'cyan' })
            ]
          }));
          bottomStatusLine.update = update;
          return bottomStatusLine;

          function update(outcome) {
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

        /** @type {HTMLElement} */
        var searchBar;
        /** @type {HTMLInputElement} */
        var searchInput;
        /** @type {HTMLButtonElement} */
        var closeButton;
        function switchToSearch() {
          if (!searchBar) {
            searchBar = elem('div', {
              parent: title,
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
                    if (event.keyCode === 27) closeSearch();
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
                  textContent: '×',
                  onclick: (event) => {
                    event.preventDefault();
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
          setTimeout(() => {
            searchBar.style.display = 'none';
            searchInput.value = '';
            subtitleArea.innerHTML = '';
            clearTimeout(debounceTimeoutSearchInput);
          }, 100);
        }

        var debounceTimeoutSearchInput;
        /** @param {Event} event */
        function handleInputEventQueue(event) {
          clearTimeout(debounceTimeoutSearchInput);
          debounceTimeoutSearchInput = setTimeout(handleInputEventDebounced, 200);
        }

        var latestSearchInputApplied;
        function handleInputEventDebounced() {
          const currentSearchInputStr = (searchInput.value || '').trim();
          if (currentSearchInputStr === latestSearchInputApplied) return;

          console.log('search to run: ', currentSearchInputStr);
          latestSearchInputApplied = currentSearchInputStr;
          applySearchText(currentSearchInputStr);
        }

        /** @param {string} searchText */
        function applySearchText(searchText) {
          if (!searchText) {
            reportNoMatches();
            return;
          }

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

          /** @type {[shortDID: string, rank: number][]} */
          const matches = [];
          for (const shortDID in users) {
            const usrTuple = users[shortDID];
            const shortHandle = usrTuple[0];
            const displayName = usrTuple[4];

            let matchRank = 0;

            if (displayName) {
              searchWordRegExp.lastIndex = 0;
              while (true) {
                const match = searchWordRegExp.exec(displayName);
                if (!match) break;
                matchRank += (match[0].length / displayName.length) * 20;
                if (match.index === 0) matchRank += 30;
              }

              if (mushMatch.test(displayName)) matchRank += 3;
              if (mushMatchLead.test(displayName)) matchRank += 5;
            }

            searchWordRegExp.lastIndex = 0;
            while (true) {
              const match = searchWordRegExp.exec(shortHandle);
              if (!match) break;
              matchRank += (match[0].length / shortHandle.length) * 30;
              if (match.index === 0) matchRank += 40;
            }

            if (mushMatch.test(shortHandle)) matchRank += 3;
            if (mushMatchLead.test(shortHandle)) matchRank += 5;

            if (matchRank) matches.push([shortDID, matchRank]);
          }

          matches.sort((m1, m2) => m2[1] - m1[1]);
          if (!matches?.length) {
            reportNoMatches();
          } else {
            reportMatches(matches);
          }

        }

        function reportNoMatches() {
          subtitleArea.innerHTML = '<div style="font-style: italic; font-size: 80%; text-align: center; opacity: 0.6;">No matches.</div>';
        }

        /**
         * @param {[shortDID: string, rank: number][]} matches
         */
        function reportMatches(matches) {
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
            const shortDID = matches[iMatch][0];
            const usrTuple = users[shortDID];
            const shortHandle = usrTuple[0];
            const displayName = usrTuple[4];

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
                    shortHandle,
                    !displayName ? undefined : elem('span', {
                      textContent: ' ' + displayName,
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
                focusAndHighlightUser(shortDID);
              }
            });

          }
        }

      }

      /** @type {Function[]} */
      var higlightUserStack;
      /** @param {string} shortDID */
      function focusAndHighlightUser(shortDID) {
        const MAX_HIGHLIGHT_COUNT = 25;
        while (higlightUserStack?.length > MAX_HIGHLIGHT_COUNT) {
          const dispose = higlightUserStack.shift();
          dispose?.();
        }

        const usrTuple = users[shortDID];
        const shortHandle = usrTuple[0];
        const displayName = usrTuple[4];
        const xSpace = usrTuple[1];
        const ySpace = usrTuple[2];

        //troika_three_text
        const { x, y, h } = mapUserCoordsToAtlas(xSpace, ySpace, userBounds);
        const r = Math.sqrt(x * x + y * y);
        const angle = Math.atan2(y, x);
        const xPlus = (r + 0.09) * Math.cos(angle);
        const yPlus = (r + 0.09) * Math.sin(angle);
        const hPlus = h + 0.04;
        orbit.moveAndPauseRotation({ x: xPlus, y: yPlus, h: hPlus });

        const userColor = defaultUserColorer(shortDID);

        const material = new THREE.MeshLambertMaterial({
          color: userColor,
          transparent: true,
          opacity: 0.9,
          // emissive: userColor,
        });
        const stem = new THREE.CylinderGeometry(0.0005, 0.00001, 0.001);
        const ball = new THREE.SphereGeometry(0.003);
        const stemMesh = new THREE.Mesh(stem, material);
        const ballMesh = new THREE.Mesh(ball, material);
        stemMesh.position.set(x, h + 0.005, y);
        stemMesh.scale.set(1, 10, 1);

        ballMesh.position.set(x, h + 0.0125, y);
        scene.add(stemMesh);
        scene.add(ballMesh);

        const text = new troika_three_text.Text();
        text.text = '@' + shortHandle;
        text.fontSize = 0.01;
        text.color = userColor;
        // text.outlineWidth = 0.0005;
        // text.outlineBlur = 0.005;
        text.position.set(-0.005, 0.03, 0);
        //text.depthOffset = 0.001;
        const group = new THREE.Group();
        group.position.set(x, h, y);
        group.add(/** @type {*} */(text));
        group.rotation.y = 0.001;
        ballMesh.onBeforeRender = applyTextBillboarding;
        //text.geometry.onBeforeRender = applyTextBillboarding;
        //group.onBeforeRender = applyTextBillboarding;
        scene.add(group);
        text.sync();

        if (!higlightUserStack) higlightUserStack = [unhighlightUser];
        else higlightUserStack.push(unhighlightUser);

        function applyTextBillboarding() {
          group.rotation.y = Math.atan2(
            (camera.position.x - group.position.x),
            (camera.position.z - group.position.z));
          text.sync();
        }

        function unhighlightUser() {
          scene.remove(group);
          text.dispose();

          scene.remove(stemMesh);
          scene.remove(ballMesh);
          material.dispose();
          stem.dispose();
          ball.dispose();

          /** @type {*} */(focusAndHighlightUser).unhighlightUser = undefined;
        }
      }


      /**
       * @param {HTMLElement} touchElement
       * @param {(xy: { x: number, y: number }) => void} touchCallback
       */
      function handleTouch(touchElement, touchCallback) {
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
          /** @typedef {{ parentElement?: El | null }} El */
          var testElem = /** @type {El | null | undefined} */(event.target);
          while (testElem && testElem !== document.body) {
            if (testElem === domElements.titleBar) return true;
            if (testElem === domElements.subtitleArea) return true;
            if (testElem === domElements.bottomStatusLine) return true;
            if (testElem === renderer.domElement) return false;
            if (testElem === domElements.root) return false;
            testElem = testElem.parentElement;
          }
          return true;
        }

        /**@param {TouchEvent} event */
        function handleTouch(event) {
          if (genuineUX(event)) return;

          const touches = event.changedTouches || event.targetTouches || event.touches;
          if (touches?.length) {
            for (const t of touches) {
              touchCoords = { x: t.pageX || t.clientX, y: t.pageY || t.clientY };
              break;
            }
          }

          event.preventDefault();
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

        let lastCameraUpdate;
        /** @type {{ x: number, y: number, z: number }} */
        let lastCameraPos;
        let lastRender;
        let lastBottomStatsUpdate;
        function renderFrame() {
          const now = Date.now();
          let rareMoved = false;
          if (!lastCameraPos || !(now < lastCameraUpdate + 200)) {
            lastCameraUpdate = now;
            if (!lastCameraPos) lastCameraPos = {
              x: NaN, y: NaN, z: NaN
            };

            const dist = Math.sqrt(
              (camera.position.x - lastCameraPos.x) * (camera.position.x - lastCameraPos.x) +
              (camera.position.y - lastCameraPos.y) * (camera.position.y - lastCameraPos.y) +
              (camera.position.z - lastCameraPos.z) * (camera.position.z - lastCameraPos.z));
            
            if (!(dist < 0.0001)) {
              rareMoved = true;
              if (Number.isFinite(dist)) {
                const vib = dist / 0.1;
                if (vib > 1) {
                  try {
                    if (typeof navigator.vibrate === 'function') {
                      navigator.vibrate(Math.floor(vib) * 30);
                    }
                  } catch (bibErr) {}
                }
              }
            }
          }

          stats.begin();
          const delta = lastRender ? now - lastRender : 0;
          lastRender = now;
          orbit.controls.update(Math.min(delta / 1000, 0.2));
          fh.tickAll(delta / 1000);
          // shaderState.updateOnFrame(rareMoved);

          renderer.render(scene, camera);
          stats.end();

          if (rareMoved) {
            lastCameraPos.x = camera.position.x;
            lastCameraPos.y = camera.position.y;
            lastCameraPos.z = camera.position.z;
            domElements.status.update();
            location.hash = '#' + camera.position.x.toFixed(2) + ',' + camera.position.y.toFixed(2) + ',' + camera.position.z.toFixed(2);
          }

          if (!(now - lastBottomStatsUpdate < 1000) && domElements.bottomStatusLine) {
            lastBottomStatsUpdate = now;
            domElements.bottomStatusLine.update(fh);
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
       *  userMapper(i: K, pos: THREE.Vector4, extra: THREE.Vector4): void;
       *  userColorer(i: K): number;
       *  fragmentShader?: string;
       *  vertexShader?: string;
       * }} _ 
       * @template K
       */
      function billboardShaderRenderer({ userKeys, userMapper, userColorer, fragmentShader, vertexShader }) {
        const baseHalf = 1.5 * Math.tan(Math.PI / 6);
        let positions = new Float32Array([
          -baseHalf, 0, -0.5,
          0, 0, 1,
          baseHalf, 0, -0.5
        ]);
        let offsetBuf = new Float32Array(userKeys.length * 4);
        let diameterBuf = new Float32Array(userKeys.length);
        let extraBuf = new Float32Array(userKeys.length * 4);
        let colorBuf = new Uint32Array(userKeys.length);
        let offsetsChanged = false;
        let diametersChanged = false;
        let colorsChanged = false;
        let extrasChanged = false;

        populateAttributes(userKeys);

        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(offsetBuf, 3));
        geometry.setAttribute('diameter', new THREE.InstancedBufferAttribute(diameterBuf, 1));
        geometry.setAttribute('extra', new THREE.InstancedBufferAttribute(extraBuf, 4));
        geometry.setAttribute('color', new THREE.InstancedBufferAttribute(colorBuf, 1));
        geometry.instanceCount = userKeys.length;

        const material = new THREE.ShaderMaterial({
          uniforms: {
            time: { value: Date.now() / 1000.0 }
          },
          vertexShader: /* glsl */`
            precision highp float;

            attribute vec3 offset;
            attribute float diameter;
            attribute vec4 extra;
            attribute uint color;

            uniform float time;

            varying vec3 vPosition;
            varying vec3 vOffset;
            varying float vDiameter;
            varying vec4 vExtra;

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
            varying vec4 vExtra;

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

              float fogStart = 0.5;
              float fogGray = 1.0;
              float fogRatio = vFogDist < fogStart ? 0.0 : vFogDist > fogGray ? 1.0 : (vFogDist - fogStart) / (fogGray - fogStart);

              vec4 tintColor = vColor;
              tintColor.a = radiusRatio;
              gl_FragColor = mix(gl_FragColor, vec4(1.0,1.0,1.0,0.7), fogRatio);
              gl_FragColor = vDiameter < 0.0 ? vec4(0.6,0.0,0.0,1.0) : gl_FragColor;
              gl_FragColor.a = bodyRatio;

              vec3 position = vPosition;
              vec3 offset = vOffset;
              float diameter = vDiameter;
              vec4 extra = vExtra;

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
          material.uniforms['time'].value = (Date.now() - worldStartTime) / 1000;
        };
        return { mesh, updateUserSet };

        /**
         * @param {Parameters<typeof userColorer>[0][]} userKeys
         */
        function populateAttributes(userKeys) {
          const userPos = new THREE.Vector4();
          const userExtra = new THREE.Vector4();
          const oldUserPos = new THREE.Vector4();
          const oldUserExtra = new THREE.Vector4();

          for (let i = 0; i < userKeys.length; i++) {
            const user = userKeys[i];
            userExtra.copy(userPos.set(NaN, NaN, NaN, NaN));
            userMapper(user, userPos, userExtra);
            oldUserPos.set(
              offsetBuf[i * 3 + 0],
              offsetBuf[i * 3 + 1],
              offsetBuf[i * 3 + 2],
              diameterBuf[i]);
            oldUserExtra.set(
              extraBuf[i * 4 + 0],
              extraBuf[i * 4 + 1],
              extraBuf[i * 4 + 2],
              extraBuf[i * 4 + 3]);
            const oldColor = colorBuf[i];

            offsetBuf[i * 3 + 0] = userPos.x;
            offsetBuf[i * 3 + 1] = userPos.y;
            offsetBuf[i * 3 + 2] = userPos.z;
            diameterBuf[i] = userPos.w;
            colorBuf[i] = userColorer(user);
            extraBuf[i * 4 + 0] = userExtra.x;
            extraBuf[i * 4 + 1] = userExtra.y;
            extraBuf[i * 4 + 2] = userExtra.z;
            extraBuf[i * 4 + 3] = userExtra.w;

            if (offsetBuf[i * 3 + 0] !== oldUserPos.x
              || offsetBuf[i * 3 + 1] !== oldUserPos.y
              || offsetBuf[i * 3 + 2] !== oldUserPos.z)
              offsetsChanged = true;
            if (diameterBuf[i] !== oldUserPos.w)
              diametersChanged = true;
            if (extraBuf[i * 4 + 0] !== oldUserExtra.x ||
              extraBuf[i * 4 + 1] !== oldUserExtra.y ||
              extraBuf[i * 4 + 2] !== oldUserExtra.z ||
              extraBuf[i * 4 + 3] !== oldUserExtra.w)
              extrasChanged = true;
            if (colorBuf[i] !== oldColor)
              colorsChanged = true;
          }
        }

        /**
         * @param {Parameters<typeof userColorer>[0][]} userKeys
         */
        function updateUserSet(userKeys) {
          if (userKeys.length > colorBuf.length) {
            const newSize = Math.max(colorBuf.length * 2, userKeys.length);
            offsetBuf = new Float32Array(newSize * 3);
            diameterBuf = new Float32Array(newSize);
            colorBuf = new Uint32Array(newSize);
            extraBuf = new Float32Array(newSize * 4);

            geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(offsetBuf, 3));
            geometry.attributes['offset'].needsUpdate = true;
            geometry.setAttribute('color', new THREE.InstancedBufferAttribute(colorBuf, 1));
            geometry.attributes['color'].needsUpdate = true;
            geometry.setAttribute('diameter', new THREE.InstancedBufferAttribute(diameterBuf, 1));
            geometry.attributes['diameter'].needsUpdate = true;
            geometry.setAttribute('extra', new THREE.InstancedBufferAttribute(extraBuf, 4));
            geometry.attributes['extra'].needsUpdate = true;
          }

          populateAttributes(userKeys);
          if (offsetsChanged) geometry.attributes['offset'].needsUpdate = true;
          if (diametersChanged) geometry.attributes['diameter'].needsUpdate = true;
          if (colorsChanged) geometry.attributes['color'].needsUpdate = true;
          if (extrasChanged) geometry.attributes['extra'].needsUpdate = true;
          
          const LOG_BUFFER_UPDATES = false;
          if (LOG_BUFFER_UPDATES && (
            offsetsChanged ||
            diametersChanged ||
            colorsChanged ||
            extrasChanged)) {
            console.log('changed: ' +
              (offsetsChanged ? 'o' : ' ') +
              (diametersChanged ? 'd' : ' ') +
              (colorsChanged ? 'c' : ' ') +
              (extrasChanged ? 'x' : ' '),
              ' ',
              userKeys.length
            );
          }

          offsetsChanged =
            diametersChanged =
            colorsChanged =
            extrasChanged =
            false;

          geometry.instanceCount = userKeys.length;
        }
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
          if (key === 'parent' || key === 'parentElement')
            setParent = /** @type {*} */(style[key]);
          else if (key === 'children')
            appendChildren = /** @type {*} */(style[key]);
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
