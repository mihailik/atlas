// @ts-check

import { CID } from 'multiformats';
import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as troika_three_text from 'troika-three-text';

if (typeof atlas === 'function') {
  if (atlas.imports) exportToGlobal(atlas.imports);
  else atlas.imports = exportToGlobal({});
} else if (typeof window !== 'undefined') {
  if (window.imports) exportToGlobal(window.imports);
  else window.imports = exportToGlobal({});
} else if (typeof global !== 'undefined') {
  if (global.imports) exportToGlobal(global.imports);
  else global.imports = exportToGlobal({});
}

if (typeof module !== 'undefined') exportToGlobal(module.exports || (module.exports = {}));

function exportToGlobal(exports) {
  exports['@atproto/api'] = require('@atproto/api');
  exports['@ipld/car'] = require('@ipld/car');
  exports['cbor-x'] = require('cbor-x');
  exports['multiformats'] = { CID };

  if (typeof window !== 'undefined' || typeof importScripts !== 'undefined') {
    exports['three'] = THREE;
    exports['three/addons/libs/stats.module.js'] = Stats;
    exports['three/addons/controls/OrbitControls.js'] = OrbitControls;
    exports['troika-three-text'] = troika_three_text;
  }

  if (!exportToGlobal.__logOnce) {
    exportToGlobal.__logOnce = true;
    console.log('libraries ', Object.keys(exports));
  }
  return exports;
}