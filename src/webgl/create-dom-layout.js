// @ts-check

import { PerspectiveCamera } from 'three';
import { elem } from '../ui/elem';

/**
 * @param {{
 *  canvas3D: HTMLElement,
 *  statsElem: HTMLElement,
 *  userCount: number,
 * }} _
 */
export function createDOMLayout({ canvas3D, statsElem, userCount }) {
  let title, titleBar, subtitleArea, rightStatus, searchMode, bottomStatusLine;
  const root = elem('div', {
    parent: document.body,
    style: `
          position: fixed; left: 0; top: 0; width: 100%; height: 100%;
          display: grid; grid-template-rows: auto auto 1fr auto; grid-template-columns: 1fr;
          `,
    children: [
      canvas3D,
      titleBar = elem('div', {
        style: `
              background: rgba(0,0,0,0.5); color: gold;
              display: grid; grid-template-rows: auto; grid-template-columns: auto 1fr auto;
              z-index: 10;
              max-height: 5em;`,
        children: [
          statsElem,
          title = elem('h3', {
            style: `
                  text-align: center;
                  font-weight: 100;
                  align-self: center;
                  margin: 0.1em;
                  `,
            children: [
              elem('span', 'display: inline-block; width: 1em;'),
              elem('span', { textContent: 'Atlas 3D' }),
              elem('span', {
                className: 'search-icon',
                innerHTML: `<style>
                        .search-icon {
                          display: inline-block;
                          transform: rotate(314deg);
                          cursor: pointer;
                        }
                        .search-icon:before {
                          content: '';
                          display: inline-block;
                          border-top: solid 1px currentColor;
                          width: 0.3em;
                          height: 0.25em;
                        }
                        .search-icon:after {
                          content: '';
                          display: inline-block;
                          border: solid 1.3px currentColor;
                          border-radius: 1em;
                          width: 0.5em;
                          height: 0.5em;
                        }
                        </style>` }),
            ]
          }),
          rightStatus = elem('div', {
            style: `
                    font-size: 80%;
                    align-self: center;
                    padding-right: 0.3em;
                    text-align: center;
                    line-height: 1;
                  `
          })
        ]
      }),
      subtitleArea = elem('div', 'color: gold; z-index: 200; position: relative;'),
      bottomStatusLine = createBottomStatusLine()
    ]
  });
  canvas3D.style.cssText = `
        position: fixed;
        left: 0; top: 0; width: 100%; height: 100%;
        `;
  canvas3D.className = 'atlas-3d';
  statsElem.style.position = 'relative';

  const status = createStatusRenderer(rightStatus);
  return { root, titleBar, subtitleArea, title, rightStatus, status, bottomStatusLine };

  /** @param {HTMLElement} rightStatus */
  function createStatusRenderer(rightStatus) {
    let cameraPos, cameraMovementIcon;

    const usersCountStr = userCount.toString();
    elem('div', {
      parent: rightStatus,
      children: [
        elem('div', {
          innerHTML:
            usersCountStr.slice(0, 3) +
            '<span style="display: inline-block; width: 0.1em;"></span>' +
            usersCountStr.slice(3)
        }),
        elem('div', { textContent: 'users' }),
      ]
    });

    const cameraStatusLine = elem('div', {
      parent: rightStatus,
      style: `font-size: 80%; opacity: 0.7; margin-top: 0.3em; transition: opacity 2s;`,
      children: [
        cameraPos = elem('span', { textContent: '0.00, 0.00, 0.00' }),
        elem('span', { style: 'display: inline-block; width: 0.25em;' }),
        cameraMovementIcon = elem('span', { textContent: '>' }),
      ]
    });

    return {
      update
    };

    /**
     * @param {PerspectiveCamera} camera
     * @param {boolean} rotating
     * @param {boolean} fallbackFirehoseMode
     */
    function update(camera, rotating, fallbackFirehoseMode) {
      cameraPos.textContent =
        camera.position.x.toFixed(2) + ', ' + camera.position.y.toFixed(2) + ', ' + camera.position.z.toFixed(2);
      cameraMovementIcon.textContent = rotating ? (fallbackFirehoseMode ? '>>' : '>') : (fallbackFirehoseMode ? '|||' : '||');
      cameraStatusLine.style.opacity = rotating ? '0.4' : '0.7';
    }
  }

  function createBottomStatusLine() {
    let flashesSection,
      labelsElem, hitTestElem, avatarImagesElem, avatarRequestsElem, avatarCachedAvatars,
      flashesElem,
      likesElem, postsElem, repostsElem, followsElem,
      unknownsPerSecElem, unknownsTotalElem;

    let flashStatsHidden = true;
    const bottomStatusLine = /** @type {HTMLDivElement & { update: typeof update }} */(elem('div', {
      style: `
                grid-row: 5;
                color: #cc903b;
                z-index: 10;
                font-size: 80%;
                text-shadow: 6px -2px 7px black, -3px -6px 7px black, 5px 4px 7px black;
                padding: 0.25em;
                padding-right: 0.5em;
                text-align: right;
                line-height: 1.5;
                pointer-events: none;
            `,
      children: [
        elem('div', {
          children: [elem('a', {
            href: 'https://bsky.app/profile/oyin.bo', innerHTML: 'created by <b>@oyin.bo</b>',
            style: 'color: gray; text-decoration: none; font-weight: 100; pointer-events: all;'
          })]
        }),
        elem('div', {
          children: [elem('a', {
            href: 'https://bsky.jazco.dev/', innerHTML: 'exploiting geo-spatial data from <b>@jaz.bsky.social</b>',
            style: 'color: gray; text-decoration: none; font-weight: 100; pointer-events: all;'
          })]
        }),
        elem('div', { height: '0.5em' }),
        elem('div', {
          pointerEvents: 'all',
          children: [
            flashesSection = elem('span', {
              children: [
                elem('span', {
                  textContent: '@', style: `
                          opacity: 0.6;
                          color: transparent;
                          text-shadow: cornflowerblue 0px 0px 0px;
                          font-size: 91%;
                          position: relative;
                          display: inline-block;
                          top: -0.07em;
                      ` }),
                labelsElem = elem('span', { opacity: '0.8', textContent: '0' }),
                hitTestElem = elem('span', {
                  opacity: '0.8', style: `
                        opacity: 0.8;
                        zoom: 0.6;
                        display: inline-block;
                        position: relative;
                        top: -0.5em;
                      ` }),
                elem('span', {
                  textContent: ' \ud83d\ude3a', style: `
                          opacity: 0.6;
                          color: transparent;
                          text-shadow: cornflowerblue 0px 0px 0px;
                          font-size: 68%;
                          position: relative;
                          display: inline-block;
                          top: -0.15em;
                      ` }),
                avatarImagesElem = elem('span', { opacity: '0.8', textContent: '0' }),
                elem('span', {
                  style: `
                        zoom: 0.6;
                        display: inline-block;
                        position: relative;
                        top: -0.5em;
                      `,
                  children: [
                    avatarCachedAvatars = elem('span', { opacity: '0.8' }),
                    elem('span', { opacity: '0.6', textContent: '+' }),
                    avatarRequestsElem = elem('span', { opacity: '0.8', textContent: '0' }),
                  ]
                }),
                elem('span', { textContent: ' \u26ED', color: 'transparent', textShadow: '0 0 0 cornflowerblue' }),
                flashesElem = elem('span', '0'),
                ' '],
              display: flashStatsHidden ? 'none' : 'inline',
              color: 'cornflowerblue'
            }),
            'posts+',
            postsElem = elem('span', { color: 'gold' }),
            ' \u2661+', // heart
            likesElem = elem('span', { color: 'gold' }),
            ' RT+',
            repostsElem = elem('span', { color: 'gold' }),
            ' follows+',
            followsElem = elem('span', { color: 'gold' }),
            ' ',
            elem('span', { textContent: '+', color: '#1ca1a1' }),
            unknownsPerSecElem = elem('span', { color: 'cyan' }),
            elem('span', { textContent: '/', color: '#1ca1a1' }),
            unknownsTotalElem = elem('span', { color: 'cyan' }),
            elem('span', { textContent: '?', color: '#1ca1a1' })
          ]
        }),
      ]
    }));
    bottomStatusLine.addEventListener('click', () => {
      flashStatsHidden = !flashStatsHidden;
      flashesSection.style.display = flashStatsHidden ? 'none' : 'inline';
    });

    bottomStatusLine.update = update;
    return bottomStatusLine;

    /**
     * @param {{
     *  flashes: number,
     *  likes: number,
     *  posts: number,
     *  reposts: number,
     *  follows: number,
     *  unknowns: number,
     *  unknownsTotal: number
     * }} outcome
     * @param {{
     *  labelCount: number,
     *  hitTestCount: number,
     *  avatarImages: number,
     *  avatarRequestCount: number,
     *  allCachedAvatars: number
     * }} labelsOutcome
     */
    function update(outcome, labelsOutcome) {
      labelsElem.textContent = labelsOutcome.labelCount.toString();
      hitTestElem.textContent = labelsOutcome.hitTestCount.toString();
      avatarImagesElem.textContent = labelsOutcome.avatarImages.toString();
      avatarRequestsElem.textContent = labelsOutcome.avatarRequestCount.toString();
      avatarCachedAvatars.textContent = labelsOutcome.allCachedAvatars.toString();
      flashesElem.textContent = outcome.flashes.toString();
      likesElem.textContent = outcome.likes.toString();
      postsElem.textContent = outcome.posts.toString();
      repostsElem.textContent = outcome.reposts.toString();
      followsElem.textContent = outcome.follows.toString();
      unknownsPerSecElem.textContent = outcome.unknowns.toString();
      unknownsTotalElem.textContent = outcome.unknownsTotal.toString();
      outcome.likes = 0;
      outcome.posts = 0;
      outcome.reposts = 0;
      outcome.follows = 0;
      outcome.unknowns = 0;
    }

  }

}