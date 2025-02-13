// @ts-check

/**
* @param {{
*  testLabel: TestLabel,
*  tiles: Iterable<TLabel>[],
*  tileX: number, tileY: number,
*  tileDimensionCount: number,
*  isCloseTo: (toLabel: TLabel, testLabel: TestLabel) => number,
*  isVisible: (label: TLabel) => boolean
* }} _ 
* @template TLabel
* @template TestLabel = TLabel
*/
export function nearestLabel({
  testLabel,
  tiles,
  tileX, tileY,
  tileDimensionCount,
  isCloseTo,
  isVisible }) {

  const tileLabels = tiles[tileX + tileY * tileDimensionCount];

  if (tileLabels) {
    for (const otherLabel of tileLabels) {
      if (otherLabel === /** @type {*} */(testLabel)) break;
      if (!isVisible(otherLabel)) continue;

      if (isCloseTo(otherLabel, testLabel)) return otherLabel;
    }
  }

  for (let xIndex = tileX - 1; xIndex >= 0; xIndex--) {
    const testTile = tiles[xIndex + tileY * tileDimensionCount];
    if (testTile) {
      let anyLabelsInTile = false;
      for (const otherLabel of testTile) {
        if (!isVisible(otherLabel)) continue;
        anyLabelsInTile = true;
        if (isCloseTo(otherLabel, testLabel)) return otherLabel;
      }

      // if there are no labels in the tile, we must keep looking left
      if (anyLabelsInTile) break;
    }
  }

  let stopLeftAt = 0;
  for (let yIndex = tileY - 1; yIndex >= 0; yIndex--) {
    for (let xIndex = tileX; xIndex > stopLeftAt; xIndex--) {
      const testTile = tiles[xIndex + yIndex * tileDimensionCount];
      if (testTile) {
        let anyLabelsInTile = false;
        for (const otherLabel of testTile) {
          if (!isVisible(otherLabel)) continue;
          anyLabelsInTile = true;
          if (isCloseTo(otherLabel, testLabel)) return otherLabel;
        }

        // if there are no labels in the tile, we must keep looking left
        if (anyLabelsInTile) {
          stopLeftAt = xIndex;
          break;
        }
      }
    }

    if (stopLeftAt === tileX) break;
  }
}
