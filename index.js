// @ts-check
/// <reference path="./lib/global.d.ts" />

const { PostRecord } = require('@atproto/api');

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

    async function* rawFirehose() {
      // com.atproto.sync.subscribeRepos
      const agent = unauthenticatedAgent();
      yield /** @type {import('@atproto/api').ComAtprotoSyncSubscribeRepos.Commit} */({});
    }

    async function* operationsFirehose() {
      for await (const commit of api.rawFirehose()) {
        if (commit.$type !== 'com.atproto.sync.subscribeRepos#commit') {
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

  function runBrowser(invokeType) {
    console.log('browser: ', invokeType);
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

    dumpFirehose();


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
              console.log(value.record.$type, '  RECORD????????????????????????');
            } else {
              console.log(value.commit.$type, '  COMMIT????????????????????????');
            }
        }
      }
    }


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