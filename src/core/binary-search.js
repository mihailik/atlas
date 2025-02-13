// @ts-check

/**
 * https://stackoverflow.com/a/29018745/140739
 * @param {T[]} arr
 * @param {T} el
 * @param {(el1: T, el2: T) => number | null | undefined} compare_fn 
 * @returns {number}
 * @template T
 */
export function binarySearch(arr, el, compare_fn) {
  let m = 0;
  let n = arr.length - 1;
  while (m <= n) {
    let k = (n + m) >> 1;
    let cmp = /** @type {number} */(compare_fn(el, arr[k]));
    if (cmp > 0) {
      m = k + 1;
    } else if (cmp < 0) {
      n = k - 1;
    } else {
      return k;
    }
  }
  return ~m;
}