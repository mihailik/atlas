// @ts-check

/** @param {{ [shortDID: string ]: import('..').UserTuple }} users */
export function getUserCoordBounds(users) {
  const bounds = { x: { min: NaN, max: NaN }, y: { min: NaN, max: NaN }, weight: { min: NaN, max: NaN } };
  for (const shortDID in users) {
    const [shortHandle, x, y, weight] = users[shortDID];
    if (!Number.isFinite(bounds.x.min) || x < bounds.x.min) bounds.x.min = x;
    if (!Number.isFinite(bounds.x.max) || x > bounds.x.max) bounds.x.max = x;
    if (!Number.isFinite(bounds.y.min) || y < bounds.y.min) bounds.y.min = y;
    if (!Number.isFinite(bounds.y.max) || y > bounds.y.max) bounds.y.max = y;
    if (!Number.isFinite(bounds.weight.min) || weight < bounds.weight.min) bounds.weight.min = weight;
    if (!Number.isFinite(bounds.weight.max) || weight > bounds.weight.max) bounds.weight.max = weight;
  }
  return bounds;
}