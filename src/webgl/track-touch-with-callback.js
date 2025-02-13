// @ts-check

/**
 * @param {{
 *  touchElement: HTMLElement,
 *  uxElements: Element[],
 *  renderElements: Element[],
 *  touchCallback: (xy: { x: number, y: number }) => void
 * }} _
 */
export function trackTouchWithCallback({ touchElement, uxElements, renderElements, touchCallback }) {
  touchElement.addEventListener('touchstart', handleTouch);
  touchElement.addEventListener('touchend', handleTouch);
  touchElement.addEventListener('touchmove', handleTouch);
  touchElement.addEventListener('mousedown', handleMouse);
  touchElement.addEventListener('mousemove', handleMouse);
  touchElement.addEventListener('mouseup', handleMouse);

  /** @type {{ x: number, y: number} | undefined} */
  var touchCoords;
  var touchTimeout;

  /** @param {Event} event */
  function genuineUX(event) {
    var testElem = /** @type {Element | null | undefined} */(event.target);
    while (testElem && testElem !== document.body) {
      if (uxElements.indexOf(testElem) >= 0) return true;
      if (renderElements.indexOf(testElem) >= 0) return false;
      testElem = testElem.parentElement;
    }
    return true;
  }

  /**@param {TouchEvent} event */
  function handleTouch(event) {
    if (genuineUX(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const touches = event.changedTouches || event.targetTouches || event.touches;
    if (touches?.length) {
      for (const t of touches) {
        touchCoords = { x: t.pageX || t.clientX, y: t.pageY || t.clientY };
        break;
      }
    }

    if (!touchTimeout) {
      touchTimeout = setTimeout(processTouch, 100);
    }
  }

  /**@param {MouseEvent} event */
  function handleMouse(event) {
    if (genuineUX(event)) return;

    touchCoords = { x: event.pageX ?? event.clientX, y: event.pageY ?? event.clientY };
    event.preventDefault();
    if (!touchTimeout) {
      touchTimeout = setTimeout(processTouch, 100);
    }
  }

  function processTouch() {
    touchTimeout = undefined;
    if (!touchCoords) return;

    if (touchCallback) {
      const passEvent = touchCoords;
      touchCoords = undefined;
      if (typeof touchCallback === 'function')
        touchCallback(passEvent);
    }
  }
}