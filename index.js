// @ts-check

function atlas(invokeType) {
  function runBrowser(invokeType) {
    console.log('browser: ', invokeType);
  }

  function runNode(invokeType) {
    console.log('node: ', invokeType);
  }

  if (typeof window !== 'undefined' && window && typeof window.alert === 'function')
    return runBrowser(invokeType);
  else if (typeof process !== 'undefined' && process && typeof process.stdout?.write === 'function')
    return runNode(invokeType);
} atlas('init')