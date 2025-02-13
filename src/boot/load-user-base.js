// @ts-check

import { loadRelativeScriptJsonp } from '../core/load-relative-script-jsonp';

export function loadUserBase() {
  return loadRelativeScriptJsonp('../atlas-db-jsonp/users/hot.js', true /* scriptAlreadyExists */);
}