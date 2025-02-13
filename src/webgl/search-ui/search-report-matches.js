// @ts-check

import { elem } from '../../ui/elem';

/**
 * @param {{
 *  matches: { user: import('../..').UserEntry, rank: number }[],
 *  subtitleArea: HTMLElement,
 *  onChipClick: (shortDID: string, chip: HTMLElement) => void
 * }} _
 */
export function searchReportMatches({ matches, subtitleArea, onChipClick }) {
  subtitleArea.innerHTML = '';
  let scroller;
  const scrollerWrapper = elem('div', {
    parent: subtitleArea,
    style: `
            position: absolute;
            width: 100%;
            height: 2.5em;
            overflow: hidden;
            font-size: 80%;
            margin-top: 0.5em;
            `,
    children: [scroller = elem('div', {
      parent: subtitleArea,
      style: `
            position: absolute;
            overflow: auto;
            white-space: nowrap;
            width: 100%;
            height: 4em;
            padding-top: 0.2em;
            `
    })
    ]
  });

  for (let iMatch = 0; iMatch < Math.min(10, matches.length); iMatch++) {
    const match = matches[iMatch];

    const matchElem = elem('span', {
      parent: scroller,
      style: `
                margin-left: 0.3em;
                padding: 0px 0.4em 0.2em 0.2em;
                cursor: pointer;
                display: inline-box;
                border: 1px solid rgba(255, 215, 0, 0.28);
                border-radius: 1em;
                background: rgb(88 74 0 / 78%);
                text-shadow: 1px 1px 2px #0000004f;
                box-shadow: 2px 2px 7px #000000a8;
              }
              `,
      children: [
        elem('span', {
          children: [
            elem('span', { textContent: '@', style: 'opacity: 0.5; display: inline-block; transform: scale(0.8) translateY(0.05em);' }),
            match.user.shortHandle,
            !match.user.displayName ? undefined : elem('span', {
              textContent: ' ' + match.user.displayName,
              style: `
                        opacity: 0.6;
                        display: inline-block;
                        zoom: 0.7;
                        transform: scaleY(1.3) translateY(0.15em);
                        transform-origin: center;
                        max-width: 6em;
                        overflow: hidden;
                        white-space: nowrap;
                        padding-left: 0.25em;
                      `
            })
          ]
        })
      ],
      onclick: () => {
        onChipClick(match.user.shortDID, matchElem);
      }
    });

  }
}