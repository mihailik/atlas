// @ts-check

import { runWebglGalaxy } from '../webgl/run-webgl-galaxy';
import { loadUserBase } from './load-user-base';

export function boot() {

  const hotJsonPromise = loadUserBase();
  withHot(hotJsonPromise);
}

async function withHot(hotJsonPromise) {
  const hotJson = await hotJsonPromise;
  runWebglGalaxy(hotJson);
}