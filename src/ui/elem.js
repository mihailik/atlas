// @ts-check

/**
 * @param {TagName} tagName
 * @param {(
 *  Omit<
 *    Partial<HTMLElement['style']> &
 *     Partial<HTMLElementTagNameMap[TagName]
 *  >, 'children' | 'parent' | 'parentElement' | 'style'> &
 *  {
 *    children?: (Element | string | null | void | undefined)[],
 *    parent?: Element | null, 
 *    parentElement?: Element | null,
 *    style?: string | Partial<HTMLElement['style']>
 *  })=} [style]
 * @returns {HTMLElementTagNameMap[TagName]}
 * @template {string} TagName
 */
export function elem(tagName, style) {
  const el = document.createElement(tagName);

  if (style && typeof /** @type {*} */(style).appendChild === 'function') {
    const tmp = parent;
    style = /** @type {*} */(parent);
    parent = tmp;
  }

  if (typeof style === 'string') {
    if (/** @type{*} */(style).indexOf(':') >= 0) el.style.cssText = style;
    else el.className = style;
  }
  else if (style) {
    /** @type {Element | undefined} */
    let setParent;
    /** @type {Element[] | undefined} */
    let appendChildren;
    for (const key in style) {
      if (key === 'parent' || key === 'parentElement') {
        setParent = /** @type {*} */(style[key]);
        continue;
      }
      else if (key === 'children') {
        appendChildren = /** @type {*} */(style[key]);
        continue;
      }
      else if (style[key] == null || (typeof style[key] === 'function' && !(key in el))) continue;

      if (key in el.style) el.style[key] = /** @type {*} */(style[key]);
      else if (key in el) el[key] = style[key];
    }

    if (appendChildren) {
      for (const child of appendChildren) {
        if (child == null) continue;
        if (typeof child === 'string') {
          const childText = document.createTextNode(child);
          el.appendChild(childText);
        } else {
          el.appendChild(child);
        }
      }
    }

    if (setParent && typeof setParent.appendChild === 'function') setParent.appendChild(el);
  }

  return /** @type {*} */(el);
}