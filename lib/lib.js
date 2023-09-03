// @ts-check

import { CID } from 'multiformats';

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

  if (typeof window === 'undefined' && typeof importScripts !== 'undefined') {
    exports['three'] = require('three');
    exports['three/addons/libs/stats.module.js'] = require('three/addons/libs/stats.module.js');
    exports['three/addons/libs/lil-gui.module.min.js'] = require('three/addons/libs/lil-gui.module.min.js');
    exports['three/addons/controls/OrbitControls.js'] = require('three/addons/controls/OrbitControls.js');
    exports['three/addons/controls/MapControls.js'] = require('three/addons/controls/MapControls.js');
  }

  if (!exportToGlobal.__logOnce) {
    exportToGlobal.__logOnce = true;
    console.log('libraries ', Object.keys(exports));
  }
  return exports;
}