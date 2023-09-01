// @ts-check
/// <reference path="./lib/global.d.ts" />

function atlas(invokeType) {

  /** @typedef {(
   * ({$type: undefined}) |
   * ({$type: 'app.bsky.feed.like'} & import ('@atproto/api').AppBskyFeedLike.Record) |
   * ({$type: 'app.bsky.graph.follow'} & import ('@atproto/api').AppBskyGraphFollow.Record) |
   * ({$type: 'app.bsky.feed.post'} & import ('@atproto/api').AppBskyFeedPost.Record) |
   * ({$type: 'app.bsky.feed.repost'} & import ('@atproto/api').AppBskyFeedRepost.Record) |
   * ({$type: 'app.bsky.graph.listitem'} & import ('@atproto/api').AppBskyGraphListitem.Record) |
   * ({$type: 'app.bsky.graph.block'} & import ('@atproto/api').AppBskyGraphBlock.Record) |
   * ({$type: 'app.bsky.actor.profile'} & import ('@atproto/api').AppBskyActorProfile.Record)
   * ) & {
   *  cid?: string;
   *  action?: string;
   *  path?: string;
   *  timestamp?: number;
  *   repo?: string;
  *   rev?: string;
  *   seq?: number;
  *   since?: string;
   * }} FeedRecord */

  // #region api
  const api = (function () {
    const api = {
      unauthenticatedAgent,
      getAuthentication,
      authenticateExistingAgentWith,
      authenticatedAgent,
      rawFirehose,
      operationsFirehose,
      searchActorsStreaming,
      listReposStreaming,
      repeatUntilSuccess
    };

    const bskyService = 'https://bsky.social/xrpc/';

    function unauthenticatedAgent() {
      const agent = new atproto_api.BskyAgent({ service: bskyService });
      return agent;
    }

    async function getAuthentication() {
      const namePwd = prompt('Login@password');
      const posAt = (namePwd || '').indexOf('@');
      if (!namePwd || posAt < 0) throw new Error('Login/password not provided.');
      const identifier = namePwd.slice(0, posAt);
      const password = namePwd.slice(posAt + 1);
      return { identifier, password };
    }

    /** @type {import('@atproto/api').AtpAgentLoginOpts=} */
    var cachedAuth;

    /**
     * @param {import('@atproto/api').BskyAgent} agent
     * @param {import('@atproto/api').AtpAgentLoginOpts=} auth
     */
    async function authenticateExistingAgentWith(agent, auth) {
      if (auth) {
        await agent.login(auth);
        return;
      }

      if (cachedAuth) {
        try {
          await agent.login(cachedAuth);
          return;
        }
        catch {
          auth = await api.getAuthentication();
          await agent.login(auth);
          cachedAuth = auth;
        }
      }

      auth = await api.getAuthentication();
      await agent.login(auth);
      cachedAuth = auth;
    }

    /**
     * @param {import('@atproto/api').AtpAgentLoginOpts=} auth
     */
    async function authenticatedAgent(auth) {
      const agent = new atproto_api.BskyAgent({ service: bskyService });
      await api.authenticateExistingAgentWith(agent, auth);
      return agent;
    }

    /**
     * @param {() => Promise<T>} fn
     * @param {number=} repeats
     * @template T
     */
    async function repeatUntilSuccess(fn, repeats) {
      if (!repeats) repeats = 5;
      for (let i = 0; i < repeats - 1; i++) {
        try {
          return await fn();
        } catch (error) {
          await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
        }
      }
      return await fn();
    }

    var cborExtensionInstalled = false;
    async function* rawFirehose() {
      if (!cborExtensionInstalled) {
        cbor_x.addExtension({
          Class: multiformats.CID,
          tag: 42,
          encode: () => {
            throw new Error("cannot encode cids");
          },
          decode: (bytes) => {
            if (bytes[0] !== 0) {
              throw new Error("invalid cid for cbor tag 42");
            }
            return multiformats.CID.decode(bytes.subarray(1)); // ignore leading 0x00
          },
        });
      }

      const wsAddress = bskyService.replace(/^(http|https)\:/, 'wss:') + 'com.atproto.sync.subscribeRepos';
      const ws = new WebSocket(wsAddress);
      ws.addEventListener('message', handleMessage);
      ws.addEventListener('error', error => handleError(error));

      const subscription = shared.subscriptionAsyncIterator();
      try {
        for await (const entry of subscription.iterator) {
          yield /** @type {import('@atproto/api').ComAtprotoSyncSubscribeRepos.Commit}*/(entry);
        }
      } finally {
        ws.removeEventListener('message', handleMessage);
        ws.close();
      }

      async function handleError(error) {
        subscription.error(error);
      }

      async function handleMessage(e) {
        if (e.data instanceof Blob) {
          const messageBuf = await e.data.arrayBuffer();
          const entry = cbor_x.decodeMultiple(new Uint8Array(messageBuf));
          if (!entry) return;
          const [header, body] = /** @type {any[]} */(entry);
          if (header.op !== 1) return;
          subscription.next(body);
        }
      }
    }

    async function* operationsFirehose() {
      for await (const commit of api.rawFirehose()) {
        const timestamp = commit.time ? Date.parse(commit.time) : Date.now();
        if (!commit.blocks) {
          // unusual commit type?
          yield /** @type {FeedRecord} */({ timestamp });
          continue;
        }

        const car = await ipld_car.CarReader.fromBytes(commit.blocks);

        for (const op of commit.ops) {
          const cid = op.cid ? op.cid.toString() : undefined

          const block = cid && await car.get(/** @type {*} */(op.cid));
          if (!block) {
            yield /** @type {FeedRecord} */({ action: op.action, cid, path: op.path, timestamp });
            continue;
          }

          /** @type {FeedRecord} */
          const record = cbor_x.decode(block.bytes);

          record.repo = commit.repo;
          record.rev = /** @type {string} */(commit.rev);
          record.seq = commit.seq;
          record.since = /** @type {string} */(commit.since);
          record.action = op.action;
          record.cid = cid;
          record.path = op.path;
          record.timestamp = timestamp;

          yield record;
        }
      }
    }

    /** @param {{ term: string, cursor?: string, auth?: import('@atproto/api').AtpAgentLoginOpts}} _ */
    async function* searchActorsStreaming({ term, cursor, auth }) {
      const agent = await authenticatedAgent(auth);

      while (true) {
        let reply = await api.repeatUntilSuccess(() => agent.app.bsky.actor.searchActors({ cursor: cursor ?? undefined, term, limit: 100 }));

        if (!reply.data.cursor || !reply.data.actors?.length) return;
        cursor = reply.data.cursor;
        yield reply.data;
      }
    }

    /** @param {string?} cursor */
    async function* listReposStreaming(cursor) {
      let agent = unauthenticatedAgent();

      while (true) {
        const reply = await api.repeatUntilSuccess(() => agent.com.atproto.sync.listRepos({ cursor: cursor ?? undefined, limit: 1000 }));

        if (reply.data.repos?.length)
          yield reply.data;

        if (!reply.data.cursor || reply.data.cursor === cursor) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          agent = unauthenticatedAgent();
          const tryOvercome = await api.repeatUntilSuccess(() => agent.com.atproto.sync.listRepos({ cursor: cursor ?? undefined, limit: 1000 }));
          if (tryOvercome.data.cursor && tryOvercome.data.cursor !== cursor) {
            if (tryOvercome.data.repos?.length)
              yield tryOvercome.data;
            cursor = tryOvercome.data.cursor;
            continue;
          }

          return;
        }

        cursor = reply.data.cursor;
      }
    }

    return api;
  })();
  // #endregion

  // #region shared
  const shared = (function () {

    const shared = {
      debugDumpFirehose,
      subscriptionAsyncIterator,
      fallbackIterator,
      fallbackCachedFirehose,
      breakFeedUri,
      shortenDID,
      unwrapShortDID,
      shortenHandle
    };

    const uriRegex = /^at\:\/\/(did:plc:)?([a-z0-9]+)\/([a-z\.]+)\/?(.*)?$/;

    /**
     * @param {string=} uri
     */
    function breakFeedUri(uri) {
      if (!uri) return;
      const match = uriRegex.exec(uri);
      if (!match) return;
      return { shortDID: match[2], type: match[3], id: match[4] };
    }

    /** @param {string} did */
    function shortenDID(did) {
      return typeof did === 'string' ? did.replace(/^did\:plc\:/, '') : did;
    }

    function unwrapShortDID(shortDID) {
      return shortDID.indexOf(':') < 0 ? 'did:plc:' + shortDID : shortDID;
    }

    /** @param {string} handle */
    function shortenHandle(handle) {
      return handle.replace(/\.bsky\.social$/, '');
    }

    function subscriptionAsyncIterator() {
      const buffer = [];
      var resolveNext, rejectNext;
      var failed = false;
      var stopped = false;

      return {
        iterator: iterate(),
        stop,
        next,
        error
      };

      async function* iterate() {
        try {
          while (!stopped) {
            let next;
            if (buffer.length) {
              next = buffer.shift();
            } else {
              next = await new Promise((resolve, reject) => {
                resolveNext = resolve;
                rejectNext = reject;
              });
            }

            if (failed && !buffer.length)
              throw next;
            else
              yield next;
          }
        } finally {
          stopped = true;
          buffer.length = 0;
        }
      }

      function stop() {
        if (failed || stopped) return;
        stopped = true;
      }

      function next(item) {
        if (failed || stopped) return;
        if (resolveNext) {
          const resolve = resolveNext;
          resolveNext = undefined;
          rejectNext = undefined;
          resolve(item);
        } else {
          buffer.push(item);
        }
      }

      function error(error) {
        if (failed || stopped) return;
        failed = true;
        if (rejectNext) {
          const reject = rejectNext;
          resolveNext = undefined;
          rejectNext = undefined;
          reject(error);
        } else {
          buffer.push(error);
        }
      }

    }

    /**
     * @param {() => AsyncIterable | Promise<AsyncIterable<T>>} mainIterate
     * @param {() => AsyncIterable | Promise<AsyncIterable<T>>} fallbackIterate
     * @template T
     */
    async function* fallbackIterator(mainIterate, fallbackIterate) {
      let onePassed = false;
      while (true) {
        try {
          for await (const value of await mainIterate()) {
            onePassed = true;
            yield value;
          }
        } catch (error) {
          if (onePassed) throw error;
          for await (const value of await fallbackIterate()) {
            yield value;
          }
          break;
        }
      }
    }

    async function* fallbackCachedFirehose() {
      /** @type {FeedRecord[]} */
      const fakeFirehose = await fetch('../atlas-db/firehose.json').then(response => response.json());
      console.log('fakeFirehose', fakeFirehose);
      let lastTweetTime = 0;
      for (const record of fakeFirehose) {
        const delayTime = (record.timestamp || 0) - lastTweetTime;
        if (delayTime > 0 && delayTime < 10000)
          await new Promise(resolve => setTimeout(resolve, delayTime));

        if (record.timestamp && delayTime > 0)
          lastTweetTime = record.timestamp;

        yield record;
      }
    }

    async function debugDumpFirehose() {
      const firehose = api.operationsFirehose();
      for await (const record of firehose) {
        switch (record?.$type) {
          case 'app.bsky.feed.like':
            console.log(record.action + ' ' + record.$type + '  ', record.subject?.uri);
            break;

          case 'app.bsky.graph.follow':
            console.log(record.action + ' ' + record.$type + '  ', record.subject);
            break;

          case 'app.bsky.feed.post':
            console.log(record.action + ' ' + record.$type + '  ', record.text.length < 20 ? record.text : record.text.slice(0, 20).replace(/\s+/g, ' ') + '...');
            break;

          case 'app.bsky.feed.repost':
            console.log(record.action + ' ' + record.$type + '  ', record.subject?.uri);
            break;

          case 'app.bsky.graph.listitem':
            console.log(record.action + ' ' + record.$type + '  ', record.subject, ' : ', record.list);
            break;

          case 'app.bsky.graph.block':
            console.log(record.action + ' ' + record.$type + '  ', record.subject);
            break;

          case 'app.bsky.actor.profile':
            console.log(record.action + ' ' + record.$type +
              '  [', record.displayName, '] : "',
              (record.description?.length || 0) < 20 ? record.description : (record.description || '').slice(0, 20).replace(/\s+/g, ' ') + '...',
              '" : LABELS: ', record.labels ? JSON.stringify(record.labels) : record.labels);
            break;

          default:
            if (record) {
              console.log(/** @type {*} */(record).$type, '  RECORD????????????????????????\n\n');
            } else {
              console.log(/** @type {*} */(record).$type, '  COMMIT????????????????????????\n\n');
            }
        }
      }
    }

    return shared;
  })();
  // #endregion

  function runBrowser(invokeType) {
    console.log('browser: ', invokeType);
    if (invokeType === 'init') return;
    if (invokeType === 'page') firehose3D();

    /** @type {{ [shortDID: string]: string | [handle: string, displayName: string] }} */
    let userList;

    async function showFirehoseConsole() {
      let recycledLast = Date.now();
      const firehoseConsoleBoundary = document.createElement('div');
      firehoseConsoleBoundary.style.cssText = `
      position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      overflow: hidden;
      `;
      const firehoseConsoleContent = document.createElement('div');
      firehoseConsoleContent.style.cssText = `
      position: absolute;
      bottom: 0; left: 0; width: 100%;
      padding: 2em;
      font-size: 80%;
      `;
      firehoseConsoleBoundary.appendChild(firehoseConsoleContent);

      document.body.appendChild(firehoseConsoleBoundary);

      {
        const introElement = addDOM();
        introElement.style.display = 'block';
        introElement.textContent = 'Loading user list...';
        userList = await fetch('../atlas-db/users.json').then(response => response.json());
      }

      for await (const value of shared.fallbackIterator(() => api.operationsFirehose(), () => shared.fallbackCachedFirehose())) {
        addFirehoseEntry(value);
      }

      function resolveUserHandle(did) {
        const shortDID = shared.shortenDID(did);
        const user = userList[shortDID];
        return typeof user === 'string' ? '@' + shared.shortenHandle(user) : user ? '@' + shared.shortenHandle(user[0]) : shortDID ? '#' + shortDID.slice(0, 4) : shortDID;
      }

      /**
       * @param {FeedRecord} record 
       */
      function addFirehoseEntry(record) {
        const author = resolveUserHandle(record?.repo);
        switch (record?.$type) {
          case 'app.bsky.feed.like':
            const likeElement = addDOM();
            likeElement.textContent = author + ' 💓 ' + (record.subject?.uri || '').slice(-4);
            break;

          case 'app.bsky.graph.follow':
            const followElement = addDOM();
            followElement.textContent = author + ' follow> ' + resolveUserHandle(record.subject).slice(-4);
            break;

          case 'app.bsky.feed.post':
            const postElement = addDOM();
            postElement.style.display = 'block';
            postElement.style.marginTop = '1em';
            postElement.style.marginBottom = '1em';
            postElement.style.borderColor = 'black';
            postElement.style.background = 'whitesmoke';
            postElement.textContent = '📧  ' + author;
            const postText = document.createElement('span');
            postText.style.fontSize = '150%';
            postText.textContent = record.text + (
              record.embed ? '📋' : ''
            ) + (record?.path || '').slice(-4);
            postElement.appendChild(postText);
            break;

          case 'app.bsky.feed.repost':
            const repostElement = addDOM();
            repostElement.textContent = '🔁' + (record.subject?.uri || '').slice(-4);
            break;

          case 'app.bsky.graph.listitem':
            const listitemElement = addDOM();
            listitemElement.textContent = 'listitem> ' + record.subject + ' : ' + record.list;
            break;

          case 'app.bsky.graph.block':
            const blockElement = addDOM();
            blockElement.textContent = '🛑 ' + (record.subject || '').slice(-4);
            break;

          case 'app.bsky.actor.profile':
            const profileElement = addDOM();
            profileElement.style.display = 'block';
            profileElement.textContent = '👤 ' + record.displayName;
            const profileDescription = document.createElement('div');
            profileDescription.textContent = record.description || '';
            profileDescription.style.cssText = `font-decoration: italic;`;
            break;

          default:
            if (record) {
              console.log(record, record.$type, '  RECORD????????????????????????\n\n');
            } else {
              console.log(record, /** @type {*} */(record).$type, '  COMMIT????????????????????????\n\n');
            }
        }
      }

      function addDOM() {
        const elementCSS = `display: inline-block; margin: 0.1em; padding-left: 0.25em; padding-right: 0.25em; border: solid 1px silver; border-radius: 1em;`;
        const now = Date.now();
        if (now - recycledLast > 3000) {
          recycledLast = now;
          const wholeContentBounds = firehoseConsoleContent.getBoundingClientRect();
          const viewBounds = firehoseConsoleBoundary.getBoundingClientRect();

          if (wholeContentBounds.height > viewBounds.height * 2) {
            const retainHeight = Math.max(viewBounds.height * 1.5, 500);
            const removeElements = [];
            let removedHeight = 0;
            for (let i = 0; i < firehoseConsoleContent.children.length; i++) {
              const element = firehoseConsoleContent.children[i];
              if (!element) break;
              const elementBounds = element.getBoundingClientRect();
              if (wholeContentBounds.height - removedHeight - elementBounds.height < retainHeight)
                break;

              removeElements.push(element);
              removedHeight += elementBounds.height;
            }

            if (removeElements.length) {
              for (const el of removeElements) {
                firehoseConsoleContent.removeChild(el);
              }

              const reuseElement = /** @type {HTMLElement} */(removeElements[0]);
              reuseElement.innerHTML = '';
              reuseElement.style.cssText = elementCSS;
              return reuseElement;
            }
          }
        }

        const newElement = document.createElement('span');
        newElement.style.cssText = elementCSS;
        firehoseConsoleContent.appendChild(newElement);
        return newElement;
      }
    }

    async function firehose3D() {
      const view = elem('div', {
        className: 'firehose-panel-3d', parent: document.body, children: [
          elem('style', {
            innerHTML: `
.like-chip, .follow-chip {
  display: inline-block;
  border: solid 1px silver;
  border-radius: 2em;
  padding-left: 0.3em;
  padding-right: 0.36em;
  padding-bottom: 0.05em;
  margin: 0.2em;
}

.user-handle {
  display: inline-block;
  opacity: 0.6;
  zoom: 0.8;
  transform: scaleY(1.1) translateY(-0.1em);
}

.post-panel {
  border: solid 1px silver;
  border-radius: 0.7em;
  margin: 0.2em;
  padding-left: 0.25em;
  padding-bottom: 0.25em;
}

.chip-block {
  text-align: right;
}

.flying {
  position: fixed;
  bottom: 0; left: 0;
  animation: 3s linear forwards flying;

  background: white;
}

@keyframes flying {
  from {
    transform: translateY(100%) perspective(500px) translateZ(400px);
  }

  to {
    transform: translateY(-1000px) perspective(500px) translateZ(-3000px);
  }
}

.firehose-panel-3d {
  background: linear-gradient(to bottom, #326dd5, #4178db, #98b7ed, #cd8500, #fde165);
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

          ` })]
      });

      /** @type {HTMLDivElement | undefined} */
      let groupedSpansParent;

      {
        const introElement = elem('div', { className: 'firehose-intro', textContent: 'Loading user list...', parentElement: view });
        const startIntroTime = Date.now();
        userList = await fetch('../atlas-db/users.json').then(response => response.json());
        introElement.textContent = 'Loaded ' + Object.keys(userList).length + ' users in ' + (Date.now() - startIntroTime)/1000 + 's.';
      }

      for await (const record of shared.fallbackIterator(() => api.operationsFirehose(), () => shared.fallbackCachedFirehose())) {
        const renderRecord = renderRecordHTML(record);
        if (!renderRecord) continue;
        if ((renderRecord.tagName || '').toUpperCase() === 'SPAN') {
          if (!groupedSpansParent) {
            groupedSpansParent = elem('div', { className: 'chip-block', children: [renderRecord] });
          }
          groupedSpansParent.appendChild(renderRecord);
        } else {
          if (groupedSpansParent) {
            addFlyingElement(groupedSpansParent);
            groupedSpansParent = undefined;
          }

          addFlyingElement(renderRecord);
        }
      }

      /**
       * @param {HTMLElement} flyingElem
       */
      function addFlyingElement(flyingElem) {
        const flyDurationMsec = 2000;
        flyingElem.className += ' flying';
        flyingElem.style.animationDuration = flyDurationMsec + 'ms';  
        view.appendChild(flyingElem);
        setTimeout(() => {
          if (flyingElem.parentElement) flyingElem.parentElement.removeChild(flyingElem);
        }, flyDurationMsec);
      }

    }

    /**
     * @param {FeedRecord} record
     */
    function renderRecordHTML(record) {
      if (record.action !== 'create') return;
      const authorElem = renderUserHandle(record?.repo);
      switch (record?.$type) {
        case 'app.bsky.feed.like':
          const post = shared.breakFeedUri(record.subject?.uri);
          const postAuthorElem = renderUserHandle(post?.shortDID);
          // TODO: lookup post
          return elem('span', {
            className: 'like-chip', children: [
              elem('span', { className: 'like-author', children: [authorElem] }),
              elem('span', { className: 'like-icon', textContent: '💓' }),
              elem('span', { className: 'like-to', children: [postAuthorElem] }),
            ]
          });

        case 'app.bsky.graph.follow':
          const subjectUserElem = renderUserHandle(record.subject);
          return elem('span', {
            className: 'follow-chip', children: [
              elem('span', { className: 'follow-author', children: [authorElem] }),
              elem('span', { className: 'follow-icon', textContent: '>' }),
              elem('span', { className: 'follow-of', children: [subjectUserElem] }),
            ]
          });

        case 'app.bsky.feed.post':
          return elem('div', {
            className: 'post-panel', children: [
              elem('span', { className: 'post-author', children: [authorElem] }),
              elem('span', { className: 'post-icon', textContent: '📧' }),
              elem('div', { className: 'post-text', textContent: record.text }),
              record.embed && elem('span', { className: 'post-embed', textContent: '📋' })
            ]
          });

        case 'app.bsky.feed.repost':
          const origPost = shared.breakFeedUri(record.subject?.uri);
          const origPostAuthorElem = renderUserHandle(origPost?.shortDID);
          // TODO: lookup post
          return elem('span', {
            className: 'repost-chip', children: [
              elem('span', { className: 'repost-author', children: [authorElem] }),
              elem('span', { className: 'repost-icon', textContent: '🔁' }),
              elem('span', { className: 'repost-of', children: [origPostAuthorElem] }),
            ]
          });

        case 'app.bsky.graph.listitem':
          break;

        case 'app.bsky.graph.block':
          break;

        case 'app.bsky.actor.profile':
          break;

        default:
          break;
      }

      /**
       * @param {string=} did
       */
      function renderUserHandle(did) {
        if (!did) return did;
        const shortDID = shared.shortenDID(did);
        const user = userList[shortDID];
        const handle = typeof user === 'string' ? user : user ? user[0] : undefined;
        const displayName = user && typeof user !== 'string' ? user[1] : undefined;
        const shortHandle = handle ? shared.shortenHandle(handle) : undefined;

        if (shortHandle) return elem('span', {
          className: 'user-handle', title: displayName, children: [
            elem('span', { className: 'at', textContent: '@' }),
            elem('span', { className: 'user-handle-label', textContent: shortHandle }),
          ]
        });
        else return elem('span', {
          className: 'user-handle user-handle-did', title: shortDID !== did ? did : undefined, children: [
            elem('span', { className: 'hash', textContent: '#' }),
            elem('span', { className: 'did', textContent: '#' + shortDID.slice(0, 4) }),
          ]
        });
      }
    }

    /**
     * @param {TagName} tagName
     * @param {(Omit<Partial<HTMLElement['style']> & Partial<HTMLElement>, 'children' | 'parent' | 'parentElement'> & { children?: (Element | string | null | void | undefined)[], parent?: Element | null, parentElement?: Element | null  })=} [style]
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

    function patchLibExports() {
      /** @type {typeof import('./lib/lib')} */
      const localLibExports =
      // @ts-ignore
      /** @type {*} */(require('./lib')) || global;

      ipld_car = localLibExports.ipld_car;
      cbor_x = localLibExports.cbor_x;
    }

    function patchApi() {
      api.rawFirehose = nodeFirehose;
      api.getAuthentication = nodeGetAuthentication;

      async function* nodeFirehose() {

        const websocketBskyService = 'wss://bsky.social';
        const ids = {
          ComAtprotoSyncSubscribeRepos: 'com.atproto.sync.subscribeRepos'
        };

        const atproto_xprc_server = require('@atproto/xrpc-server');
        const atproto_repo = require('@atproto/repo');

        /** @type {atproto_xprc_server.Subscription<import('@atproto/api').ComAtprotoSyncSubscribeRepos.Commit>} */
        const sub = new atproto_xprc_server.Subscription({
          service: websocketBskyService,
          method: ids.ComAtprotoSyncSubscribeRepos,
          // getParams: () => /** @type {*} */(this.getCursor()),
          validate: /** @type {*} */(value) => {
            // lexicons.assertValidXrpcMessage(ids.ComAtprotoSyncSubscribeRepos, value)
            if (value?.$type === ids.ComAtprotoSyncSubscribeRepos) return value;
            return value;
          },
        });

        for await (const value of sub) {
          yield value;
        }
      }

      async function nodeGetAuthentication() {
        if (process.env.ATLASUSER && process.env.ATLASPASSWORD)
          return { identifier: process.env.ATLASUSER, password: process.env.ATLASPASSWORD };

        return new Promise((resolve, reject) => {
          const fs = require('fs');
          fs.readFile(__dirname + '/node_modules/.auth', 'utf8', (error, text) => {
            if (!error) {
              const [identifier, password] = text.split(/[\r\n]/g).filter(str => str);
              if (identifier && password) return resolve({ identifier, password });
            }

            const readline = require('readline');
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            rl.question('BSky login: ', identifier => {
              rl.question('BSky login: ', password => {
                rl.close();
                resolve({ identifier, password });
              });
            });
          });
        });
      }
    }

    const utils = (function () {
      const utils = {
        openOrCreateTextFile,
        createDirectoryRecursive,
        readTextFileFirstLine,
        overwriteFirstLine,
        overwriteLastLine
      };


      /**
       * @param {string} filePath
       * @param {string | (() => string | Promise<string>)} initContent
       * @returns {Promise<number>}
       */
      async function openOrCreateTextFile(filePath, initContent) {
        /** @type {number} */
        const openFD = await open();

        if (openFD) return openFD;

        await createDirectoryRecursive(path.basename(filePath));
        const initContentStr = typeof initContent === 'string' ? initContent : await initContent();
        await new Promise((resolve, reject) => {
          fs.writeFile(filePath, initContentStr, (err) => {
            if (err) reject(err);
            else resolve(err);
          });
        });

        return await open();

        function open() {
          return new Promise((resolve, reject) => {
            fs.open(filePath, 'r+', (_err, fd) => {
              resolve(fd);
            });
          });
        }
      }

      async function getFirstLine(filePath) {
        const maxFirstLineLength = 256;
        const fd = await utils.openOrCreateTextFile(filePath, () => { throw new Error('File not found.'); });
        const buffer = Buffer.alloc ? Buffer.alloc(maxFirstLineLength) : new Buffer(maxFirstLineLength);
        /** @type {string} */
        const fileLead = await new Promise((resolve, reject) => {
          fs.read(fd, buffer, 0, buffer.byteLength, 0, (err, bytesRead) => {
            if (err) reject(err);
            resolve(buffer.toString('utf8', 0, bytesRead));
          });
        });

        const newLineRegExp = /(\n)|(\r\n)/g;
        const endLineMatch = newLineRegExp.exec(fileLead);
        if (!endLineMatch) throw new Error('First line is longer than ' + maxFirstLineLength);
        let firstLineStart = 0;
        let firstLineEnd;
        if (endLineMatch.index) {
          firstLineEnd = endLineMatch.index;
        } else {
          const nextLineMatch = newLineRegExp.exec(fileLead);
          if (!nextLineMatch?.index) throw new Error('Multiple new lines at the start of the file.');
          firstLineStart = endLineMatch.index + endLineMatch[0].length;
          firstLineEnd = nextLineMatch.index;
        }

        return { fd, firstLineStart, firstLineEnd, firstLine: fileLead.slice(firstLineStart, firstLineEnd) };
      }


      async function readTextFileFirstLine(filePath) {
        const { firstLine } = await getFirstLine(filePath);
        return firstLine;
      }

      async function overwriteFirstLine(filePath, content) {
        const { fd, firstLineStart } = await getFirstLine(filePath);

        return new Promise((resolve, reject) => {
          fs.write(fd, content, firstLineStart, 'utf8', (err) => {
            if (err) reject(err);
            resolve(undefined);
          });
        });
      }

      async function overwriteLastLine(filePath, content) {
        const maxLastLineLength = 256;

        /** @type {import('fs').Stats} */
        const stat = await new Promise((resolve, reject) => {
          fs.stat(filePath, (err, stat) => {
            if (err) reject(err);
            else resolve(stat);
          });
        });
        if (stat.isDirectory()) throw new Error('Directory instead of file ' + filePath);

        const fd = await utils.openOrCreateTextFile(filePath, () => { throw new Error('File not found.'); });

        const buffer = Buffer.alloc ? Buffer.alloc(maxLastLineLength) : new Buffer(maxLastLineLength);
        const fileTrail = await new Promise((resolve, reject) => {
          fs.read(fd, buffer, 0, buffer.byteLength, stat.size - buffer.length, (err, bytesRead) => {
            if (err) reject(err);
            resolve(buffer.toString('utf8', 0, bytesRead));
          });
        });

        const lastLineRegExp = /((\n)|(\r\n))[^\r\n]+((\n)|(\r\n))?$/g;
        const lastLineMatch = lastLineRegExp.exec(fileTrail);
        if (!lastLineMatch) throw new Error('Garbled end of the file, no last line found in ' + maxLastLineLength + ' characters.');

        // lastLineMatch will include preceding newline, remove it from calculation
        const posLastLine = stat.size - (lastLineMatch[0].length - lastLineMatch[1].length);

        return new Promise((resolve, reject) => {
          fs.write(fd, content, posLastLine, 'utf8', (err) => {
            if (err) reject(err);
            resolve(undefined);
          });
        });
      }

      /**
       * @param {string} dirPath
       * @returns {Promise<void>}
       */
      async function createDirectoryRecursive(dirPath) {
        return new Promise((resolve, reject) => {
          fs.stat(dirPath, (err, stat) => {
            if (stat && stat.isDirectory()) return resolve();
            if (stat) return reject(new Error('File cannot be directory ' + dirPath));

            const basename = path.basename(dirPath);
            if (!basename || basename === dirPath || path.basename(basename) === basename) return resolve();
            createDirectoryRecursive(basename).then(
              () => {
                fs.mkdir(dirPath, (err) => {
                  if (err) reject(err);
                  resolve();
                });
              },
              parentError => reject(parentError));
          });
        });
      }

      return utils;
    })();

    const continueUpdateUsers = (function () {

      const cursorsJsonPath = require('path').resolve(__dirname, '../atlas-db/cursors.json');
      const usersJsonPath = require('path').resolve(__dirname, '../atlas-db/users.json');
      const reportEveryMsec = 30000;

      async function continueEnrichUsers(users) {
        let { users: { oneByOne, timestamp } } = JSON.parse(fs.readFileSync(cursorsJsonPath, 'utf8'));

        if (!users)
          users = JSON.parse(fs.readFileSync(usersJsonPath, 'utf8'));

        console.log('\x1b[31m', { oneByOne }, '\x1b[39m');

        const shortDIDs = Object.keys(users);
        const usersToEnrichLead = [];
        const usersToEnrichTail = [];
        let tailStarted = false;
        for (const shortDID of shortDIDs) {
          if (shortDID === oneByOne) tailStarted = true;
          if (!users[shortDID]) {
            if (tailStarted) usersToEnrichTail.push(shortDID);
            else usersToEnrichLead.push(shortDID);
          }
        }
        let usersToEnrich = usersToEnrichTail.concat(usersToEnrichLead);

        const agent = api.unauthenticatedAgent();

        let totalEnrichedUsers = 0;
        const startTime = Date.now() + Math.random() * reportEveryMsec;
        let lastReport = startTime;
        let addedSinceLastReport = 0;
        let skippedSinceLastReport = 0;
        for (const shortDID of usersToEnrich) {
          if (users[shortDID]) continue;

          const startEntryTime = Date.now();
          const did = shared.unwrapShortDID(shortDID);
          //const followRecords = await agent.com.atproto.repo.listRecords({ repo: did, collection: 'app.bsky.graph.follow' });
          const describeProfilePromise = agent.com.atproto.repo.describeRepo({ repo: did })
            .catch(err => console.log('    \x1b[31mcom.atproto.repo.describeRepo ', shortDID, ' ' + err.message + '\x1b[39m'));
          const profileRecordsPromise = agent.com.atproto.repo.listRecords({ repo: did, collection: 'app.bsky.actor.profile' })
            .catch(err => console.log('    \x1b[31mcom.atproto.repo.listRecords ', shortDID, ' ' + err.message + '\x1b[39m'));

          const describeProfile = await describeProfilePromise;
          const profileRecords = await profileRecordsPromise;

          if (!describeProfile || !profileRecords)
            continue;

          if (profileRecords.data.records.length > 1) {
            console.log('    \x1b[31m' + profileRecords.data.records.length + ' PROFILE RECORDS FOR ' + shortDID + '\x1b[39m');
            skippedSinceLastReport++;
            continue;
          }

          const handle = describeProfile.data.handle;
          const shortHandle = shared.shortenHandle(handle);
          const displayName = /** @type {*} */(profileRecords.data.records[0]?.value)?.displayName;

          if (users[shortDID]) {
            skippedSinceLastReport++;
          } else {
            users[shortDID] =
              displayName ? [shortHandle, displayName] :
                shortHandle;

            addedSinceLastReport++;
            totalEnrichedUsers++;

            const now = Date.now();
            if (now - lastReport > reportEveryMsec) {
              console.log(
                '\x1b[31mDESCRIBEREPOS/LISTRECORDS ',
                '[' + (!skippedSinceLastReport ? addedSinceLastReport : addedSinceLastReport + ' of ' + (addedSinceLastReport + skippedSinceLastReport)) + ']',
                ' ...' + shortDID + '/' + shortHandle + ' ' + (shortHandle === handle ? ' <**>' : ''),
                ' in ' + (now - startEntryTime) / 1000 + 's (' +
                totalEnrichedUsers + ' in ' + ((now - startTime) / 1000).toFixed(2).replace(/\.?0+$/, '') + 's, ' + (totalEnrichedUsers / (now - startTime) * 1000).toFixed(1).replace(/\.?0+$/, '') + ' per second)' +
                '\x1b[39m'
              );

              const currentCursorsJson = JSON.parse(fs.readFileSync(cursorsJsonPath, 'utf8'));
              currentCursorsJson.users.oneByOne = shortDID;
              currentCursorsJson.users.timestamp = now;
              fs.writeFileSync(cursorsJsonPath, JSON.stringify(currentCursorsJson, null, 2), 'utf8');

              writeUsers(users);

              lastReport = now;
              addedSinceLastReport = 0;
              skippedSinceLastReport = 0;
            }
          }
        }

        const now = Date.now();
        console.log(
          '\x1b[31mDESCRIBEREPOS/LISTRECORDS ' + totalEnrichedUsers + ' in ' + (now - startTime) / 1000 + 's, ' + (totalEnrichedUsers / (now - startTime) * 1000).toFixed(1).replace(/\.?0+$/, '') + ' per second\n' +
          '------- COMPLETE\x1b[39m\n\n',
        );
      }

      async function continueDumpAllUsers(users) {
        let { users: { listRepos, timestamp } } = JSON.parse(fs.readFileSync(cursorsJsonPath, 'utf8'));
        if (!users)
          users = JSON.parse(fs.readFileSync(usersJsonPath, 'utf8'));

        const startTime = Date.now();
        let startBatchTime = Date.now();

        console.log('\x1b[36m', { listRepos }, '\x1b[39m');
        let totalAddedUsers = 0;

        let batchAddedUsers = 0;
        let batchWholeSize = 0;
        let lastReport = Date.now() + Math.random() * reportEveryMsec;
        for await (const batchEntry of api.listReposStreaming(listRepos)) {
          batchWholeSize += batchEntry.repos.length;
          for (const actor of batchEntry.repos) {
            const shortDID = shared.shortenDID(actor.did);
            if (!(shortDID in users) || typeof users[shortDID] !== 'undefined') continue;
            users[shortDID] = 0;
            batchAddedUsers++;
            totalAddedUsers++;
          }

          listRepos = batchEntry.cursor;

          const now = Date.now();

          if (now - lastReport > reportEveryMsec) {
            writeUsers(users);

            const currentCursorsJson = JSON.parse(fs.readFileSync(cursorsJsonPath, 'utf8'));
            currentCursorsJson.users.listRepos = listRepos;
            currentCursorsJson.users.timestamp = now;
            fs.writeFileSync(cursorsJsonPath, JSON.stringify(currentCursorsJson, null, 2), 'utf8');

            console.log(
              '\x1b[36mLISTREPOS ',
              '[' + (batchAddedUsers === batchWholeSize ? batchAddedUsers : batchAddedUsers + ' of ' + batchWholeSize) + '] ...' + shared.shortenDID(batchEntry.repos[batchEntry.repos.length - 1].did),
              ' in ' + (now - startBatchTime) / 1000 + 's (' +
              totalAddedUsers + ' in ' + (now - startTime) / 1000 + 's, ' + (totalAddedUsers / (now - startTime) * 1000).toFixed(1).replace(/\.?0+$/, '') + ' per second)' +
              '\x1b[39m'
            );

            startBatchTime = now;
            lastReport = now;
            batchAddedUsers = 0;
            batchWholeSize = 0;
          }
        }

        const now = Date.now();
        const passedSinceMin = (now - timestamp) / 1000 / 60;
        console.log(
          '\x1b[36mLISTREPOS ',
          totalAddedUsers + ' in ' + (now - startTime) / 1000 + 's, ' + (totalAddedUsers / (now - startTime) * 1000).toFixed(1).replace(/\.?0+$/, '') + ' per second\n' +
          'since: ' + Math.round(passedSinceMin) + 'min ago (' + (totalAddedUsers / (passedSinceMin / 60)).toFixed(2).replace(/\.?0+$/, '') + ' per hour)\n' +
          Object.keys(users).length + ' users total\n' +
          Object.keys(users).filter((shortDID) => !users[shortDID]).length + ' raw DID\n' +
          Object.keys(users).filter((shortDID) => users[shortDID]).length + ' populated\n' +
          '------- COMPLETE\x1b[39m\n\n'
        );

      }

      async function continueDumpUserDetails(users) {
        let { users: { searchActors, timestamp } } = JSON.parse(fs.readFileSync(cursorsJsonPath, 'utf8'));
        if (!users)
          users = JSON.parse(fs.readFileSync(usersJsonPath, 'utf8'));

        const startTime = Date.now();
        let startBatchTime = Date.now();

        console.log({ searchActors });
        let totalAddedUsers = 0;

        let lastReport = Date.now() + Math.random() * reportEveryMsec;
        let batchAddedUsers = 0;
        let batchWholeSize = 0;
        //const searchTerm = 'bsky.social';
        const searchTerm = '1';
        for await (const batchEntry of api.searchActorsStreaming({ cursor: searchActors, term: searchTerm })) {
          batchWholeSize += batchEntry.actors.length;
          for (const actor of batchEntry.actors) {
            const shortDID = shared.shortenDID(actor.did);
            if (users[shortDID]) continue;
            const shortHandle = shared.shortenHandle(actor.handle);
            users[shortDID] = actor.displayName ? [shortHandle, actor.displayName] : shortHandle;
            batchAddedUsers++;
            totalAddedUsers++;
          }

          searchActors = batchEntry.cursor;

          const now = Date.now();
          if (now - lastReport > reportEveryMsec) {
            writeUsers(users);

            const currentCursorsJson = JSON.parse(fs.readFileSync(cursorsJsonPath, 'utf8'));
            currentCursorsJson.users.searchActors = searchActors;
            currentCursorsJson.users.timestamp = now;
            fs.writeFileSync(cursorsJsonPath, JSON.stringify(currentCursorsJson, null, 2), 'utf8');


            console.log(
              'SEARCHACTORS ',
              '[' + (batchAddedUsers === batchWholeSize ? batchAddedUsers : batchAddedUsers + ' of ' + batchWholeSize) + '] ...' +
              shared.shortenDID(batchEntry.actors[batchEntry.actors.length - 1].did) + '/' + shared.shortenHandle(batchEntry.actors[batchEntry.actors.length - 1].handle),
              ' in ' + (now - startBatchTime) / 1000 + 's (' +
              totalAddedUsers + ' in ' + (now - startTime) / 1000 + 's, ' + (totalAddedUsers / (now - startTime) * 1000).toFixed(1).replace(/\.0+$/, '') + ' per second)'
            );

            startBatchTime = now;
            batchAddedUsers = 0;
            batchWholeSize = 0;
            lastReport = now;
          }
        }

      }

      async function writeUsers(users) {
        const newUsersJsonContent = '{\n' + Object.entries(users).map(
          ([did, entry]) => JSON.stringify(did) + ':' + JSON.stringify(entry)).join(',\n') + '\n}\n';
        fs.writeFileSync(usersJsonPath, newUsersJsonContent, 'utf8');
      }

      async function continueUpdateUsers() {
        const usersJsonPath = path.resolve(__dirname, '../atlas-db/users.json');
        const users = JSON.parse(fs.readFileSync(usersJsonPath, 'utf8'));

        console.log(
          Object.keys(users).length + ' users total\n' +
          Object.keys(users).filter((shortDID) => !users[shortDID]).length + ' raw DID\n' +
          Object.keys(users).filter((shortDID) => users[shortDID]).length + ' populated');

        const finishUserDetails = continueDumpUserDetails(users);
        const finishAllUsers = continueDumpAllUsers(users);
        const finishEnrichingUsers = continueEnrichUsers(users);

        await finishUserDetails;
        await finishAllUsers;
        await finishEnrichingUsers;
      }

      continueUpdateUsers.continueDumpUserDetails = continueDumpUserDetails;
      continueUpdateUsers.continueDumpAllUsers = continueDumpAllUsers;
      continueUpdateUsers.continueEnrichUsers = continueEnrichUsers;

      return continueUpdateUsers;

    })();

    async function makeSmallFirehoseDump(count) {
      if (!count) count = 200;
      const firehoses = [];
      console.log('Dumping firehose content: [' + count + ']...');
      let start = Date.now();
      for await (const record of api.operationsFirehose()) {
        if (!record) continue;
        if (!firehoses.length) start = Date.now();
        const entry = {
          ...record,
          timestamp: (record.timestamp || Date.now()) - start
        };
        const keys = Object.keys(entry).sort();
        firehoses.push(
          '{ ' + keys.filter(key => entry[key] != null).map(key =>
            JSON.stringify(key) + ':' + JSON.stringify(entry[key])).join(',\n  ') + ' }'
        );
        if (firehoses.length % 100) process.stdout.write('-');
        else process.stdout.write('[' + firehoses.length + ']');
        if (firehoses.length > count) break;
      }

      fs.writeFileSync(
        path.resolve(__dirname, '../atlas-db/firehose.json'),
        '[\n' +
        firehoses.join(',\n') +
        '\n]\n',
        'utf8');

      console.log(' ' + firehoses.length + ' saved.');
    }


    console.log('node: ', invokeType);

    atproto_api = require('@atproto/api');
    const fs = require('fs');
    const path = require('path');

    patchLibExports();
    patchApi();

    makeSmallFirehoseDump(2000);

  }

  if (typeof window !== 'undefined' && window && typeof window.alert === 'function')
    return runBrowser(invokeType);
  else if (typeof process !== 'undefined' && process && typeof process.stdout?.write === 'function')
    return runNode(invokeType);
} atlas('init')