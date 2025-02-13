// @ts-check

import { runWebglGalaxy } from '../webgl/run-webgl-galaxy';
import { loadUserBase } from './load-user-base';

export function boot() {

  const hotJsonPromise = loadUserBase();
  withHot(hotJsonPromise);
}

async function withHot(hotJsonPromise) {
  const hotJson = await hotJsonPromise;
  const atlasInit = /** @type {HTMLElement} */(document.querySelector('.atlas-init'));
  if (atlasInit) {
    atlasInit.style.transition = 'opacity 2s';
    setTimeout(() => {
      atlasInit.style.opacity = '0';

      atlasInit.style.opacity = '0';
      setTimeout(() => {
        atlasInit?.remove();
      }, 2000);
    }, 10);
  }

  runWebglGalaxy(hotJson);
}