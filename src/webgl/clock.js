// @ts-check

export function makeClock() {
  const clock = {
    worldStartTime: performance.now(),
    nowMSec: 0,
    nowSeconds: 0,
    update
  };

  return clock;

  function update() {
    clock.nowSeconds =
      (clock.nowMSec = performance.now() - clock.worldStartTime)
      / 1000;
  }
}