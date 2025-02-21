// @ts-check

import { Vector3 } from 'three';
import { findUserMatches } from '../search/find-user-matches';
import { processUsersToTiles } from '../tiles/process-users-to-tiles';
import { makeClock } from './clock';
import { createDOMLayout } from './create-dom-layout';
import { focusAndHighlightUser } from './focus-and-highlight-user';
import { handleWindowResizes } from './handle-window-resizes';
import { renderGeoLabels } from './render-geo-labels';
import { searchReportMatches } from './search-ui/search-report-matches';
import { searchReportNoMatches } from './search-ui/search-report-no-matches';
import { searchUIController } from './search-ui/search-ui-controller';
import { setupOrbitControls } from './setup-orbit-controls';
import { setupScene } from './setup-scene';
import { trackFirehose } from './track-firehose';
import { trackTouchWithCallback } from './track-touch-with-callback';
import { shaderLayoutGPU } from './shader-layout/shader-layout-gpgpu';

export async function constructStateAndRun(rawUsers) {
  const startProcessToTiles = Date.now();
  const usersAndTiles = await processUsersToTiles({ users: rawUsers, dimensionCount: 48, sleep: () => new Promise(resolve => setTimeout(resolve, 1)) });
  console.log('Processed users to tiles in ', Date.now() - startProcessToTiles, ' msec');
  const clock = makeClock();

  const {
    scene,
    camera,
    renderer,
    stats,
    updateUsers
  } = setupScene(usersAndTiles.all, clock);

  const domElements = createDOMLayout({
    canvas3D: renderer.domElement,
    statsElem: stats.dom,
    userCount: usersAndTiles.all.length
  });



  const orbit =
    // setupOrbitControls2({ camera, host: renderer.domElement, clock, scene });
    setupOrbitControls({ camera, host: renderer.domElement, clock });

  // domElements.rightStatus.addEventListener('click', () => {
  //   orbit.flipControlType();
  // });

  const searchUI = searchUIController({
    titleBarElem: domElements.title,
  });

  searchUI.onClose = () => {
    domElements.subtitleArea.innerHTML = '';
  };

  searchUI.onSearchText = (searchText) => {
    const matches = findUserMatches(searchText, usersAndTiles.all);
    if (!matches?.length) searchReportNoMatches(domElements.subtitleArea);
    else searchReportMatches({
      matches,
      subtitleArea: domElements.subtitleArea,
      onChipClick: (shortDID, userChipElem) =>
        focusAndHighlightUser({
          shortDID,
          users: usersAndTiles.byShortDID,
          scene,
          camera,
          moveAndPauseRotation: orbit.moveAndPauseRotation
        })
    });
  };

  /** @type {ReturnType<typeof shaderLayoutGPU<import('..').UserEntry>> | undefined} */
  let shaderLayout;

  searchUI.onLayout = () => {
    if (!shaderLayout) {
      shaderLayout = shaderLayoutGPU({
        particles: usersAndTiles.all,
        get: (user, coords) => {
          coords.x = user.x;
          coords.y = user.h;
          coords.z = user.y;
          coords.mass = user.weight;
          coords.vx = 0;
          coords.vy = 0;
          coords.vz = 0;
        },
        set: (user, coords) => {
          user.x = coords.x;
          user.h = coords.y;
          user.y = coords.z;
          user.vx = coords.vx;
          user.vy = coords.vy;
          user.vz = coords.vz;
        }
      });
    }

    const applyBack = shaderLayout.runLayout(0.001);
    applyBack();
  };

  if (location.hash?.length > 3) {
    const hasCommaParts = location.hash.replace(/^#/, '').split(',');
    if (hasCommaParts.length === 3) {
      const [cameraX, cameraY, cameraZ] = hasCommaParts.map(parseFloat);
      camera.position.set(cameraX, cameraY, cameraZ);
    }
  }

  handleWindowResizes(camera, renderer);

  trackTouchWithCallback({
    touchElement: document.body,
    uxElements: [domElements.titleBar, domElements.subtitleArea, domElements.bottomStatusLine],
    renderElements: [renderer.domElement, domElements.root],
    touchCallback: (xy) => {
      // console.log('touch ', xy);
    }
  });

  const firehoseTrackingRenderer = trackFirehose({ users: usersAndTiles.byShortDID, clock });
  scene.add(firehoseTrackingRenderer.mesh);

  const geoLayer = renderGeoLabels({
    users: usersAndTiles.all,
    tiles: usersAndTiles.tiles,
    tileDimensionCount: usersAndTiles.dimensionCount,
    clock
  });
  scene.add(geoLayer.layerGroup);

  startAnimation();

  function startAnimation() {

    requestAnimationFrame(continueAnimating);

    function continueAnimating() {
      requestAnimationFrame(continueAnimating);
      renderFrame();
    }

    let lastCameraUpdate;
    /** @type {Vector3} */
    let lastCameraPos;
    let lastRender;
    let lastBottomStatsUpdate;
    let lastVibeCameraPos;
    let lastVibeTime;
    function renderFrame() {
      clock.update();

      geoLayer.updateWithCamera(camera);

      let rareMoved = false;
      if (!lastCameraPos || !(clock.nowMSec < lastCameraUpdate + 200)) {
        lastCameraUpdate = clock.nowMSec;
        if (!lastCameraPos) lastCameraPos = new Vector3(NaN, NaN, NaN);

        const dist = camera.position.distanceTo(lastCameraPos);

        if (!(dist < 0.0001)) {
          rareMoved = true;
        }
      }

      if (!lastVibeCameraPos) {
        lastVibeCameraPos = camera.position.clone();
        lastVibeTime = clock.nowMSec;
      } else {
        const vibeDist = camera.position.distanceTo(lastVibeCameraPos);
        if (Number.isFinite(vibeDist) && vibeDist > 0.1 && (clock.nowMSec - lastVibeTime) > 200) {
          lastVibeCameraPos.copy(camera.position);
          lastVibeTime = clock.nowMSec;
          try {
            if (typeof navigator.vibrate === 'function') {
              navigator.vibrate(30);
            }
          } catch (bibErr) { }
        }

      }

      stats.begin();
      const delta = lastRender ? clock.nowMSec - lastRender : 0;
      lastRender = clock.nowMSec;
      orbit.controls?.update?.(Math.min(delta / 1000, 0.2));
      // firehoseTrackingRenderer.tickAll(delta / 1000);

      renderer.render(scene, camera);
      stats.end();

      if (rareMoved) {
        lastCameraPos.copy(camera.position);
        domElements.status.update(
          camera,
          orbit.rotating,
          firehoseTrackingRenderer.fallback
        );

        const updatedHash =
          '#' +
          camera.position.x.toFixed(2) + ',' + camera.position.y.toFixed(2) + ',' + camera.position.z.toFixed(2) +
          '';

        try {
          history.replaceState(null, '', updatedHash);
        } catch (_error) {
        }
      }

      if (!(clock.nowMSec - lastBottomStatsUpdate < 1000) && domElements.bottomStatusLine) {
        lastBottomStatsUpdate = clock.nowMSec;
        domElements.bottomStatusLine.update(firehoseTrackingRenderer, geoLayer);
      }
    }
  }
}