// @ts-check

import * as atproto_api_import from '@atproto/api';
// export * as atproto_repo from '@atproto/repo';
// export * as atproto_server from '@atproto/xrpc-server';

import { CarReader } from '@ipld/car';
import { addExtension, decode, decodeMultiple } from 'cbor-x';
import {CID } from 'multiformats';

export const atproto_api = atproto_api_import;
export const ipld_car = { CarReader };
export const cbor_x = { addExtension, decode, decodeMultiple };
export const multiformats = { CID };

exportToGlobal(
  typeof window !== 'undefined' && window ? window :
    typeof module !== 'undefined' && module?.exports ? module.exports :
      typeof global !== 'undefined' && global ? global :
        this);

function exportToGlobal(window) {
  window.atproto_api = atproto_api;
  window.ipld_car = ipld_car;
  window.cbor_x = cbor_x;
  window.multiformats = multiformats;
}