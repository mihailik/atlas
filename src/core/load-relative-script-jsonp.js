// @ts-check

/**
 * @param {string} relativePath
 * @param {boolean | HTMLElement} [scriptAlreadyExists]
 */
export function loadRelativeScriptJsonp(relativePath, scriptAlreadyExists) {
  const localPromise = loadDirect(relativePath, scriptAlreadyExists);

  const withFallbackPromise = localPromise
    .catch(withError);
  
  return withFallbackPromise;

  function withError(error) {
    return (
      new Promise(resolve => setTimeout(resolve, 300))
        .then(() =>
          loadDirect(relativePath.replace(/^\.\.\//, 'https://oyin.bo/'), false)
        )
    );
  }

  /**
   * @param {string} src
   * @param {boolean | HTMLElement | undefined} scriptAlreadyExists
   */
  function loadDirect(src, scriptAlreadyExists) {
    return new Promise((resolve, reject) => {

      const funcName = jsonpFuncName(src);

      window[funcName] = hotLoaded;

      if (!scriptAlreadyExists) {
        scriptAlreadyExists = [...document.scripts].find(scr => scr.src === src);
      }

      let script;
      if (!scriptAlreadyExists) {
        script = document.createElement('script');
        script.defer = true;
        script.async = true;
        script.onerror = function (err) {
          script.remove();
          console.error('Error loading ' + funcName + ' data:', err);
          reject(new Error('Error loading ' + funcName + ' data ' + String(err)));
        };

        script.src = src;

        (document.head || document.body).appendChild(script);
      }

      function hotLoaded(data) {
        if (!scriptAlreadyExists) script?.remove();
        window['hot'] = undefined;
        delete window['hot'];
        if (data instanceof Error) return reject(data);
        else resolve(data);
      }

    });
  }
}

/** @param {string} path */
function jsonpFuncName(path) {
  return /** @type {string} */(path.split(/[/\\]/g).pop())
    .replace(/\.js$/, '')
    .replace(/[^a-z0-9]/ig, '');
}