// @ts-check

/** @param {number=} concurrency @param {number=} cooldown */
export function createThrottledQueue(concurrency, cooldown) {

  let busy = 0;

  const result = {
    concurrency: concurrency || 3,
    cooldown: cooldown || 0,
    eventually,
    queued: /** @type {{ [key: string]: Promise & { priority: number} }} */({})
  };

  return result;

  /**
   * @param {string} arg
   * @param {(arg: string) => Promise<T>} call
   * @returns {Promise<T> & { priority: number }}
   * @template T
   */
  function eventually(arg, call) {
    let entry = result.queued[arg];
    if (entry) return entry;

    let resolve, reject;
    /** @type {*} */
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise._arg = arg;
    promise._call = call;
    promise._resolve = resolve;
    promise._reject = reject;
    promise.priority = 0;
    promise.then(completed, completed);
    result.queued[arg] = promise;
    setTimeout(workMore, result.cooldown);
    return /** @type {*} */(result.queued[arg]) = promise;
  }

  function completed() {
    busy--;
    setTimeout(workMore, result.cooldown);
  }

  function workMore() {
    if (busy >= result.concurrency) return;

    /** @type {*} */
    let topPriorityValue;
    for (const key in result.queued) {
      const entry = result.queued[key];
      if (!topPriorityValue || entry.priority > topPriorityValue.priority)
        topPriorityValue = entry;
    }

    if (!topPriorityValue) return;

    busy++;
    const { _arg, _call, _resolve, _reject } = topPriorityValue;
    delete result.queued[_arg];
    _call(_arg).then(_resolve, _reject);

    if (busy < result.concurrency) setTimeout(workMore, result.cooldown);
  }
}
