// @ts-check

/** @param {HTMLElement} subtitleArea */
export function searchReportNoMatches(subtitleArea) {
  subtitleArea.innerHTML = '<div style="font-style: italic; font-size: 80%; text-align: center; opacity: 0.6;">No matches.</div>';
}