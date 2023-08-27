// @ts-check
/// <reference path="./lib/global.d.ts" />

function atlas(invokeType) {

  /** @typedef {(
  * ({$type: 'app.bsky.feed.like'} & import ('@atproto/api').AppBskyFeedLike.Record) |
  * ({$type: 'app.bsky.graph.follow'} & import ('@atproto/api').AppBskyGraphFollow.Record) |
  * ({$type: 'app.bsky.feed.post'} & import ('@atproto/api').AppBskyFeedPost.Record) |
  * ({$type: 'app.bsky.feed.repost'} & import ('@atproto/api').AppBskyFeedRepost.Record)
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
      dumpFirehose,
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

    async function dumpFirehose() {
      const firehose = api.operationsFirehose();
      for await (const value of firehose) {
        switch (value.record?.$type) {
          case 'app.bsky.feed.like':
            console.log(value.record.$type, '  ', value.record.subject?.uri);
            break;

          case 'app.bsky.graph.follow':
            console.log(value.record.$type, '  ', value.record.subject);
            break;

          case 'app.bsky.feed.post':
            console.log(value.record.$type, '  ', value.record.text.length < 20 ? value.record.text : value.record.text.slice(0, 20).replace(/\s+/g, ' ') + '...');
            break;

          case 'app.bsky.feed.repost':
            console.log(value.record.$type, '  ', value.record.subject?.uri);
            break;

          default:
            if (value.record) {
              console.log(/** @type {*} */(value.record).$type, '  RECORD????????????????????????');
            } else {
              console.log(value.commit.$type, '  COMMIT????????????????????????');
            }
        }
      }
    }

    return shared;
  })();

  function runBrowser(invokeType) {
    console.log('browser: ', invokeType);
    if (invokeType === 'init') return;
    if (invokeType === 'page') shared.dumpFirehose();
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

    shared.dumpFirehose();


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