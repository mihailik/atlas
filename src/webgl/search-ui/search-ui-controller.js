// @ts-check

import { elem } from '../../ui/elem';

/**
 * @param {{
 *  titleBarElem: HTMLElement
 * }} _
 */
export function searchUIController({ titleBarElem }) {
  /** @type {HTMLElement} */
  var searchBar;
  /** @type {HTMLInputElement} */
  var searchInput;
  /** @type {HTMLButtonElement} */
  var closeButton;

  var searchClosedAt = 1;

  const controller = {
    showSearch,
    closeSearch,
    /** @type {((searchText: string) => void) | undefined} */
    onSearchText: undefined,
    /** @type {(() => void) | undefined} */
    onLayout: undefined,
    /** @type {(() => void) | undefined} */
    onClose: undefined
  };

  titleBarElem.addEventListener('click', () => {
    if (Date.now() - searchClosedAt < 500) return;
    showSearch();
  });

  return controller;

  function showSearch() {
    if (!searchClosedAt) return;
    searchClosedAt = 0;

    if (!searchBar) {
      searchBar = elem('div', {
        parent: titleBarElem,
        style: 'position: relative; border-bottom: solid 1px #888;',
        children: [
          searchInput = elem('input', {
            style: `
                  position: relative;
                  left: 0; top: 0; width: 100%; height: 100%;
                  background: transparent;
                  color: gold;
                  border: none;
                  outline: none;
                  `,
            onkeydown: (event) => {
              if (event.keyCode === 27) {
                controller.onClose?.();
                closeSearch();
              } else if (event.keyCode === 13 && searchInput.value === '/layout') {
                searchInput.value = '';
                controller.onClose?.();
                closeSearch();
                controller.onLayout?.();
                return;
              }
              handleInputEventQueue(event);
            },
            onkeyup: handleInputEventQueue,
            onkeypress: handleInputEventQueue,
            onmousedown: handleInputEventQueue,
            onmouseup: handleInputEventQueue,
            onmouseleave: handleInputEventQueue,
            onchange: handleInputEventQueue,
            oninput: handleInputEventQueue,
            placeholder: '    find accounts...'
          }),
          closeButton = elem('button', {
            style: `
                    position: absolute; right: 0; top: 0; width: 2em; height: 100%;
                    background: transparent; border: none; outline: none;
                    color: gold; font-size: 80%;
                    cursor: pointer;
                    `,
            textContent: '\u00d7', // cross like x, but not a letter
            onclick: (event) => {
              event.preventDefault();
              controller.onClose?.();
              closeSearch();
            }
          })
        ]
      });
    }
    searchBar.style.display = 'block';
    searchInput.focus();
  }

  function closeSearch() {
    if (searchClosedAt) return;
    searchClosedAt = Date.now();

    setTimeout(() => {
      searchBar.style.display = 'none';
      searchInput.value = '';
      clearTimeout(debounceTimeoutSearchInput);
    }, 100);
  }

  var debounceTimeoutSearchInput;
  /** @param {Event} event */
  function handleInputEventQueue(event) {
    clearTimeout(debounceTimeoutSearchInput);
    if (searchClosedAt) return;
    debounceTimeoutSearchInput = setTimeout(handleInputEventDebounced, 200);
  }

  var latestSearchInputApplied;
  function handleInputEventDebounced() {
    if (searchClosedAt) return;
    const currentSearchInputStr = (searchInput.value || '').trim();
    if (currentSearchInputStr === latestSearchInputApplied) return;

    console.log('search to run: ', currentSearchInputStr);
    latestSearchInputApplied = currentSearchInputStr;
    controller.onSearchText?.(currentSearchInputStr);
  }
}