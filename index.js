// @ts-check
/// <reference path="./lib/global.d.ts" />

function atlas(invokeType) {

  /** @typedef {(
  * ({$type: 'app.bsky.feed.like'} & import ('@atproto/api').AppBskyFeedLike.Record) |
  * ({$type: 'app.bsky.graph.follow'} & import ('@atproto/api').AppBskyGraphFollow.Record) |
  * ({$type: 'app.bsky.feed.post'} & import ('@atproto/api').AppBskyFeedPost.Record) |
  * ({$type: 'app.bsky.feed.repost'} & import ('@atproto/api').AppBskyFeedRepost.Record) |
  * ({$type: 'app.bsky.graph.listitem'} & import ('@atproto/api').AppBskyGraphListitem.Record) |
  * ({$type: 'app.bsky.graph.block'} & import ('@atproto/api').AppBskyGraphBlock.Record) |
  * ({$type: 'app.bsky.actor.profile'} & import ('@atproto/api').AppBskyActorProfile.Record)
  * )} FeedRecord */

  const api = (function () {
    const api = {
      unauthenticatedAgent,
      rawFirehose,
      operationsFirehose
    };

    const bskyService = 'https://bsky.social/xrpc/';

    function unauthenticatedAgent() {
      const agent = new atproto_api.BskyAgent({ service: bskyService });
      return agent;
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

      const subscription = shared.subscriptionAsyncIterator();
      try {
        for await (const entry of subscription.iterator) {
          yield /** @type {import('@atproto/api').ComAtprotoSyncSubscribeRepos.Commit}*/(entry);
        }
      } finally {
        ws.removeEventListener('message', handleMessage);
        ws.close();
      }

      async function handleMessage(e) {
        if (e.data instanceof Blob) {
          const messageBuf = await e.data.arrayBuffer();
          // @ts-ignore
          const [header, body] = cbor_x.decodeMultiple(new Uint8Array(messageBuf));
          if (header.op !== 1) return;
          subscription.next(body);
          // const car = await ipld_car.CarReader.fromBytes(body.blocks);
          // for (const op of body.ops) {
          //   if (!op.cid) continue;
          //   const block = await car.get(op.cid);
          //   if (!block) return;

          //   const record = cbor_x.decode(block.bytes);
          //   if (record.$type === "app.bsky.feed.post" && typeof record.text === "string") {
          //     // Optional filter out empty posts
          //     if (record.text.length > 0) {
          //       const rkey = op.path.split("/").at(-1);

          //       await _appendToFeed(body.repo, record, rkey);
          //     }
          //   }
          // }
        }
      }
    }

    async function* operationsFirehose() {
      for await (const commit of api.rawFirehose()) {
        if (!commit.blocks) {
          // unusual commit type?
          yield { commit };
          continue;
        }

        const car = await ipld_car.CarReader.fromBytes(commit.blocks);

        for (const op of commit.ops) {
          if (!op.cid) continue;
          const block = await car.get(/** @type {*} */(op.cid));
          if (!block) {
            yield { commit, op };
            continue;
          }

          /** @type {FeedRecord} */
          const record = cbor_x.decode(block.bytes);
          yield { commit, op, record };
        }
      }
    }

    return api;
  })();

  const shared = (function () {

    const shared = {
      debugDumpFirehose,
      subscriptionAsyncIterator
    };

    function subscriptionAsyncIterator() {
      const buffer = [];
      var resolveNext, rejectNext;
      var failed = false;
      var stopped = false;

      return {
        iterator: iterate(),
        next,
        error
      };

      async function* iterate() {
        try {
          while (true) {
            if (stopped) return;

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

    async function debugDumpFirehose() {
      const firehose = api.operationsFirehose();
      for await (const value of firehose) {
        switch (value.record?.$type) {
          case 'app.bsky.feed.like':
            console.log(value.op?.action + ' ' + value.record.$type + '  ', value.record.subject?.uri);
            break;

          case 'app.bsky.graph.follow':
            console.log(value.op?.action + ' ' + value.record.$type + '  ', value.record.subject);
            break;

          case 'app.bsky.feed.post':
            console.log(value.op?.action + ' ' + value.record.$type + '  ', value.record.text.length < 20 ? value.record.text : value.record.text.slice(0, 20).replace(/\s+/g, ' ') + '...');
            break;

          case 'app.bsky.feed.repost':
            console.log(value.op?.action + ' ' + value.record.$type + '  ', value.record.subject?.uri);
            break;

          case 'app.bsky.graph.listitem':
            console.log(value.op?.action + ' ' + value.record.$type + '  ', value.record.subject, ' : ', value.record.list);
            break;

          case 'app.bsky.graph.block':
            console.log(value.op?.action + ' ' + value.record.$type + '  ', value.record.subject);
            break;

          case 'app.bsky.actor.profile':
            console.log(value.op?.action + ' ' + value.record.$type +
              '  [', value.record.displayName, '] : "',
              (value.record.description?.length || 0) < 20 ? value.record.description : (value.record.description || '').slice(0, 20).replace(/\s+/g, ' ') + '...',
              '" : LABELS: ', value.record.labels ? JSON.stringify(value.record.labels) : value.record.labels);
            break;

          default:
            if (value.record) {
              console.log(/** @type {*} */(value.record).$type, '  RECORD????????????????????????\n\n');
            } else {
              console.log(value.commit.$type, '  COMMIT????????????????????????\n\n');
            }
        }
      }
    }

    return shared;
  })();

  function runBrowser(invokeType) {
    console.log('browser: ', invokeType);
    if (invokeType === 'init') return;
    if (invokeType === 'page') showFirehoseConsole();

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

      const firehose = api.operationsFirehose();
      for await (const value of firehose) {
        switch (value.record?.$type) {
          case 'app.bsky.feed.like':
            const likeElement = addDOM();
            likeElement.textContent = '💓' + (value.record.subject?.uri || '').slice(-4);
            break;

          case 'app.bsky.graph.follow':
            const followElement = addDOM();
            followElement.textContent = 'follow> ' + (value.record.subject || '').slice(-4);
            break;

          case 'app.bsky.feed.post':
            const postElement = addDOM();
            postElement.style.display = 'block';
            postElement.style.marginTop = '1em';
            postElement.style.marginBottom = '1em';
            postElement.style.borderColor = 'black';
            postElement.style.background = 'whitesmoke';
            postElement.textContent = '📧 ';
            const postText = document.createElement('span');
            postText.style.fontSize = '150%';
            postText.textContent = value.record.text + (
              value.record.embed ? '📋' : ''
            ) + (value.op?.path || '').slice(-4);
            postElement.appendChild(postText);
            break;

          case 'app.bsky.feed.repost':
            const repostElement = addDOM();
            repostElement.textContent = '🔁' + (value.record.subject?.uri || '').slice(-4);
            break;

          case 'app.bsky.graph.listitem':
            const listitemElement = addDOM();
            listitemElement.textContent = 'listitem> ' + value.record.subject + ' : ' + value.record.list;
            break;

          case 'app.bsky.graph.block':
            const blockElement = addDOM();
            blockElement.textContent = '🛑 ' + (value.record.subject || '').slice(-4);
            break;

          case 'app.bsky.actor.profile':
            const profileElement = addDOM();
            profileElement.style.display = 'block';
            profileElement.textContent = '👤 ' + value.record.displayName;
            const profileDescription = document.createElement('div');
            profileDescription.textContent = value.record.description || '';
            profileDescription.style.cssText = `font-decoration: italic;`;
            break;

          default:
            if (value.record) {
              console.log(value, /** @type {*} */(value.record).$type, '  RECORD????????????????????????\n\n');
            } else {
              console.log(value, value.commit.$type, '  COMMIT????????????????????????\n\n');
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

              /** @type {HTMLElement} */
              const reuseElement = removeElements[0];
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
  }

  function runNode(invokeType) {
    console.log('node: ', invokeType);

    atproto_api = require('@atproto/api');

    /** @type {typeof import('./lib/lib')} */
    const localLibExports =
      // @ts-ignore
      /** @type {*} */(require('./lib')) || global;

    ipld_car = localLibExports.ipld_car;
    cbor_x = localLibExports.cbor_x;

    api.rawFirehose = nodeFirehose;

    shared.debugDumpFirehose();


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
  }

  if (typeof window !== 'undefined' && window && typeof window.alert === 'function')
    return runBrowser(invokeType);
  else if (typeof process !== 'undefined' && process && typeof process.stdout?.write === 'function')
    return runNode(invokeType);
} atlas('init')