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
   *  post(author: string, postID: string, text: string, replyTo?: { shortDID: string, postID: string }, replyToThread?: { shortDID: string, postID: string });
   *  repost(who: string, whose: string, postID: string);
   *  like(who: string, whose: string, postID: string);
   *  follow(who: string, whom: string);
   *  error(error: Error): void;
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

    const wsAddress = bskyService.replace(/^(http|https)\:/, 'wss:') + 'com.atproto.sync.subscribeRepos';
    const ws = new WebSocketImpl(wsAddress);
    ws.addEventListener('message', handleMessage);
    ws.addEventListener('error', error => handleError(error));

    return { stop };

    function stop() {
      ws.close();
    }

    async function handleMessage(event) {
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
      const subject = breakFeedUri(likeRecord.subject?.uri);
      if (!subject) return; // TODO: alert incomplete like

      return callbacks.like(commitShortDID, subject.shortDID, subject.postID);
    }

    /** @param {FeedRecordTypeMap['app.bsky.graph.follow']} followRecord */
    function handleFollow(commitShortDID, followRecord) {
      const whom = shortenDID(followRecord.subject);
      if (!whom) return; // TODO: alert incomplete follow

      return callbacks.follow(commitShortDID, whom);
    }

    /** @param {FeedRecordTypeMap['app.bsky.feed.post']} postRecord */
    function handlePost(commitShortDID, postID, postRecord) {
      const replyTo = breakFeedUri(postRecord.reply?.parent?.uri);
      const replyToThread = postRecord.reply?.root?.uri === postRecord.reply?.parent?.uri ?
        undefined :
        breakFeedUri(postRecord.reply?.root?.uri);

      return callbacks.post(commitShortDID, postID, postRecord.text, replyTo, replyToThread);
    }

    /** @param {FeedRecordTypeMap['app.bsky.feed.repost']} repostRecord */
    function handleRepost(commitShortDID, repostRecord) {
      const subject = breakFeedUri(repostRecord.subject?.uri);
      if (!subject) return; // TODO: alert incomplete repost

      return callbacks.repost(commitShortDID, subject.shortDID, subject.postID);
    }

    function handleError(event) {
      callbacks.error(event);
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

  async function runBrowser(invokeType) {
    const users = await boot();
    /** @type {typeof import('three')} */
    const THREE = /** @type {*} */(atlas).imports['three'];
    const Stats = /** @type {*} */(atlas).imports['three/addons/libs/stats.module.js'];
    const OrbitControls = /** @type {*} */(atlas).imports['three/addons/controls/OrbitControls.js'];

    console.log('Users: ', users);
    threedshell();

    async function boot() {
      const INIT_UI_FADE_MSEC = 2000;
        // @ts-ignore
      const waitForRunBrowserNext = new Promise(resolve => runBrowser = resolve);

        // @ts-ignore
      let waitForUsersLoaded = new Promise((resolve, reject) => typeof hot !== 'undefined' ? resolve(hot) :
        hot = value =>
          value.message ? reject(value) : resolve(value))
        .catch(() => {
          return new Promise((resolve, reject) => {
            const loadAbsoluteScript = document.createElement('script');
            loadAbsoluteScript.onerror = reject;
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
        console.log(1234);
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
        controls
      } = setupScene();

      const domElements = appendToDOM();
      handleWindowResizes();
      webgl_buffergeometry_instancing_demo();
      startAnimation();

      function setupScene() {
        const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 1000);
        camera.position.x = 0.05;
        camera.position.z = 2;
        camera.position.y = 0.1;

        // const camera = new THREE.PerspectiveCamera(
        //   15,
        //   window.innerWidth / window.innerHeight, 1, 10 * 1000 * 1000);
        // camera.position.set(-10500, 10500, 1500);
      // TODO: restore camera position from window.name

        const scene = new THREE.Scene();
        //scene.background = new THREE.Color(0xA0A0A0);

        const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.7);
        dirLight1.position.set(3000, 1500, -3000);
        scene.add(dirLight1);

        const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.7);
        dirLight2.position.set(-3000, 1500, -3000);
        scene.add(dirLight2);

        // const pointLight = new THREE.PointLight(0xffffff, 3, 0, 0);
        // pointLight.position.set(0, 2000, 4000);
        // // scene.add(pointLight);

        // const pointLight2 = new THREE.PointLight(0xffffff, 3, 0, 0);
        // pointLight2.position.set(2000, 0, 4000);
        // // scene.add(pointLight2);

        const ambientLight = new THREE.AmbientLight(0x101010, 3);
        scene.add(ambientLight);

        const renderer = new THREE.WebGLRenderer();
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);

        const stats = new Stats();

        const clock = new THREE.Clock();
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.maxDistance = 40 * 1000;
        controls.enableDamping = true;

        scene.add(new THREE.AxesHelper(1000));

        return {
          scene,
          camera,
          lights: { dirLight1, dirLight2, ambientLight },
          renderer,
          stats,
          clock,
          controls
        };
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

        function renderFrame() {
          stats.begin();
          const delta = clock.getDelta();

          renderer.render(scene, camera);
          controls.update(delta);
          stats.end();
        }
      }

      function webgl_buffergeometry_instancing_demo() {

        const positions = [
          0.025, - 0.025, -0.01,
          -0.025, 0.025, -0.01,
          0, 0, 0.03
        ];
        const offsets = [];
        const colors = [];

        const bounds = { x: { min: NaN, max: NaN }, y: { min: NaN, max: NaN } };
        for (const shortDID in users) {
          const [shortHandle, x, y] = users[shortDID];
          if (!Number.isFinite(bounds.x.min) || x < bounds.x.min) bounds.x.min = x;
          if (!Number.isFinite(bounds.x.max) || x > bounds.x.max) bounds.x.max = x;
          if (!Number.isFinite(bounds.y.min) || y < bounds.y.min) bounds.y.min = y;
          if (!Number.isFinite(bounds.y.max) || y > bounds.y.max) bounds.y.max = y;
        }

        // instanced attributes
        let instanceCount = 0;
        for (const shortDID in users) {
          instanceCount++;
          const [shortHandle, x, y] = users[shortDID];

          // offsets
          const xRatiod = (x - bounds.x.min) / (bounds.x.max - bounds.x.min);
          const yRatiod = (y - bounds.y.min) / (bounds.y.max - bounds.y.min);
          const r = Math.sqrt(xRatiod * xRatiod + yRatiod * yRatiod);

          offsets.push(xRatiod - 0.5, (1 - r * r) * 0.6, yRatiod - 0.5);

          // colors
          colors.push(Math.random(), Math.random(), Math.random(), Math.random());

          //if (instanceCount > 20) break;
        }

        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3));
        geometry.setAttribute('color', new THREE.InstancedBufferAttribute(new Float32Array(colors), 4));

        const material = new THREE.ShaderMaterial({
          uniforms: {
            'time': { value: 1.0 },
            'sineTime': { value: 1.0 }
          },
          vertexShader: `
		precision highp float;

		uniform float time;

		attribute vec3 offset;
		attribute vec4 color;

		varying vec3 vPosition;
		varying vec4 vColor;

		void main(){

			vColor = color;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( mix(position, offset * 1.6, 0.9), 1.0 );

		}
          `,
          fragmentShader: `
    precision highp float;

		uniform float time;

		varying vec3 vPosition;
		varying vec4 vColor;

		void main() {

			vec4 color = vec4( vColor );
			color.r += sin( vPosition.x * 10.0 + time ) * 0.5;

			gl_FragColor = color;
    }
          `,
          side: THREE.DoubleSide,
          forceSinglePass: true,
        });

        //

        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
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
  }


  /** @param {{ [shortDID: string]: UserTuple }} users */
  function firehoseSpatialAdjustments(users) {
    // have axis orders, to make it easier to find users near each other

    const horizontalOrderedShortDIDs = Object.keys(users).sort((shortDID1, shortDID2) =>
      users[shortDID1][1] - users[shortDID2][1]);

    const verticalOrderedShortDIDs = horizontalOrderedShortDIDs.slice().sort((shortDID1, shortDID2) =>
      users[shortDID1][2] - users[shortDID2][2]);

    const massCenter = getMassCenter(users);


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