// @ts-check

import { BufferGeometry, CircleGeometry, Group, Line, Material, Mesh, MeshBasicMaterial, PerspectiveCamera, Texture, TextureLoader, Vector3 } from 'three';
import { Text as troika_Text } from 'troika-three-text';

import { isPromise } from '../coldsky-borrow/is-promise';
import { unwrapShortDID } from '../coldsky-borrow/shorten';

import { distance2D } from '../geometry/distance';
import { createThrottledQueue } from '../legacy/create-throttled-queue';
import { nearestLabel } from '../tiles/nearest-label';

/**
 * @param {{
 *  users: import('..').UserEntry[],
 *  tiles: import('..').UserEntry[][],
 *  tileDimensionCount: number,
 *  clock: ReturnType<typeof import('./clock').makeClock>
 * }} _
 */
export function renderGeoLabels({ users, tiles, tileDimensionCount, clock }) {
  const ANIMATE_LENGTH_SEC = 0.7;
  const MIN_SCREEN_DISTANCE = 0.5;
  const MAX_LABELS = 120;
  /**
   * @typedef {ReturnType<typeof createLabel>} LabelInfo
   */

  const avatarTextureLoader = new TextureLoader();
  const avatarRequestQueue = createThrottledQueue(3, 300);
  let avatarRequestSuccesses = 0;
  let avatarRequestFailures = 0;

  /** @type {{ [shortDID: string]: string | Promise<string> & { priority: number } }} */
  const avatarCids = {};

  const layerGroup = new Group();

  /** @type {Set<LabelInfo>[]} */
  const labelsByTiles = [];
  const labelsByShortDID = {};

  const pBuf = new Vector3();

  const outcome = {
    layerGroup,
    updateWithCamera,
    labelCount: 0,
    hitTestCount: 0,
    allCachedAvatars: 0,
    avatarRequestCount: 0,
    avatarImages: 0
  };

  addFixedUsers();

  return outcome;

  function addFixedUsers() {
    const fixedUsers = getFixedUsers();
    for (const user of fixedUsers) {
      const label = createLabel(user);
      label.fixed = true;
      const xTileIndex = Math.floor((user.x + 1) / 2 * tileDimensionCount);
      const yTileIndex = Math.floor((user.y + 1) / 2 * tileDimensionCount);
      const tileIndex = xTileIndex + yTileIndex * tileDimensionCount;
      const tileBucket = labelsByTiles[tileIndex] || (labelsByTiles[tileIndex] = new Set());
      tileBucket.add(label);
      labelsByShortDID[user.shortDID] = label;
      layerGroup.add(label.group);
    }
  }

  /** @typedef {{ shortDID: string, x: number, y: number, h: number, weight: number }} TileUserEntry */

  function getFixedUsers() {
    const include = [
      'oyin.bo', 'africanceleb', 'ohkafuimykafui', 'jaz', 'kite.black', 'mathan.dev', 'wolfigelkott.crimea.ua',
      'tressiemcphd', 'theferocity', 'reniadeb', 'kevinlikesmaps', 'rasmansa', 'thieflord.dev',
      'twoscooters', 'finokoye', 'teetotaller', 'hystericalblkns', 'faytak', 'xkcd.com'];
    const exclude = ['dougchu'];
    const MAX_NUMBER_OF_LARGEST = 300;
    const MIN_DISTANCE = 0.1;

    /** @type {import('..').UserEntry[]} */
    const fixedUsers = [];

    /** @type {import('..').UserEntry[]} */
    const largestUsers = [];

    for (const user of users) {
      const userTooSmall = largestUsers.length === MAX_NUMBER_OF_LARGEST && user.weight <= largestUsers[largestUsers.length - 1].weight;

      if (userTooSmall && fixedUsers.length === include.length) continue;

      if (exclude.indexOf(user.shortHandle) >= 0) continue;
      if (include.indexOf(user.shortHandle) >= 0) {
        fixedUsers.push(user);
        continue;
      }

    }

    pruneCrowdedNeighbours(largestUsers);

    return fixedUsers.concat(largestUsers);

    /** @param {{ shortDID: string, x: number, y: number, weight: number }[]} largestUsers */
    function pruneCrowdedNeighbours(largestUsers) {
      for (let i = 1; i < largestUsers.length; i++) {
        const current = largestUsers[i];
        for (let j = 0; j < i; j++) {
          const prev = largestUsers[j];
          const dist = distance2D(prev.x, prev.y, current.x, current.y);
          if (dist < MIN_DISTANCE) {
            largestUsers.splice(i, 1);
            i--;
            break;
          }
        }
      }
    }
  }

  /** @param {import('..').UserEntry} user */
  function createLabel(user) {
    /** @type {MeshBasicMaterial | undefined} */
    let lineMaterial;

    /** @type {Texture} */
    let avatarTexture;

    /** @type {Material} */
    let avatarMaterial;

    /** @type {CircleGeometry} */
    let avatarGeometry;

    /** @type {Mesh} */
    let avatarMesh;

    let xmin, ymin, xmax, ymax;

    outcome.labelCount++;

    let disposed = false;

    const text = new troika_Text();
    text.text = '@' + user.shortHandle;
    text.fontSize = 0.004;
    text.color = user.colorRGB;
    text.outlineWidth = 0.00043;
    text.outlineBlur = 0.0016;
    text.position.set(0.003, 0.004, 0);
    text.sync(() => {
      const visibleBounds = text.textRenderInfo?.visibleBounds
      if (!visibleBounds) return;
      [xmin, ymin, xmax, ymax] = visibleBounds;

      if (!lineMaterial)
        lineMaterial = new MeshBasicMaterial({ color: user.colorRGB, transparent: true });

      const underlineOffset = -0.006;
      const startOffset = 0.0015;
      const geometry = new BufferGeometry().setFromPoints([
        new Vector3(0, 0, 0),
        new Vector3(xmin + text.position.x + startOffset, text.position.y + underlineOffset, 0),
        new Vector3(xmax + text.position.x, text.position.y + underlineOffset, 0),
      ]);

      const line = new Line(geometry, lineMaterial);
      group.add(line);
    });

    const group = new Group();
    group.position.set(user.x, user.h, user.y);
    group.add(/** @type {*} */(text));
    group.rotation.z = 0.3;

    const label = {
      user,
      addedAtSec: clock.nowSeconds,
      group,
      fixed: false,
      searchResult: false,
      animationEndsAtSec: clock.nowSeconds + ANIMATE_LENGTH_SEC,
      visible: true,
      screenX: NaN,
      screenY: NaN,
      textWidth: NaN,
      textHeight: NaN,
      updateWithCamera,
      dispose
    };

    retrieveAvatar();

    return label;

    function dispose() {
      disposed = true;
      group.clear();
      text.dispose();
      lineMaterial?.dispose();
      avatarTexture?.dispose();
      avatarMaterial?.dispose();
      avatarGeometry?.dispose();
      outcome.labelCount--;
      if (avatarMaterial) outcome.avatarImages--;
    }

    /** @param {Vector3} cameraPos */
    function updateWithCamera(cameraPos) {
      const SCALE_LABELS_CLOSER_THAN = 0.23;
      const trueVisible = label.visible ||
        label.animationEndsAtSec >= clock.nowSeconds;

      if (trueVisible) {
        group.visible = true;
        group.rotation.y = Math.atan2(
          (cameraPos.x - group.position.x),
          (cameraPos.z - group.position.z));

        const scale = cameraPos.distanceTo(group.position) < SCALE_LABELS_CLOSER_THAN ?
          cameraPos.distanceTo(group.position) / SCALE_LABELS_CLOSER_THAN :
          1 + (cameraPos.distanceTo(group.position) / SCALE_LABELS_CLOSER_THAN - 1) * 0.2;
        group.scale.set(scale, scale, scale);

        if (xmin && xmax) {
          label.textWidth = (xmax - xmin) * scale;
          label.textHeight = (ymax - ymin) * scale;
        }

        // 0 to 1 when animation ends
        const animationPhase = (clock.nowSeconds - (label.animationEndsAtSec - ANIMATE_LENGTH_SEC)) / ANIMATE_LENGTH_SEC;

        const opacity =
          // after animation finished, steady state
          animationPhase > 1 ? (label.visible ? 1 : 0) :
            // fade in
            label.visible ? animationPhase :
              // fade out
              1 - animationPhase;

        text.strokeOpacity = text.outlineOpacity = opacity * opacity;
        text.fillOpacity = opacity;
        if (lineMaterial && lineMaterial?.opacity !== opacity) {
          lineMaterial.opacity = opacity;
          lineMaterial.needsUpdate = true;
        }

        const avatarRequest = avatarRequestQueue.queued[user.shortDID];
        if (avatarRequest)
          avatarRequest.priority += 1;

        if (avatarMaterial && avatarMaterial.opacity !== opacity) {
          avatarMaterial.opacity = opacity;
          avatarMaterial.needsUpdate = true;
        }

        text.sync();
      } else {
        group.visible = false;
        delete avatarRequestQueue.queued[user.shortDID];
      }
    }

    function retrieveAvatar() {
      if (!avatarRequestSuccesses && avatarRequestFailures > 5) {
        avatarRequestQueue.concurrency = 0;
        return;
      }

      let avatarCidPromise = avatarCids[user.shortDID];
      if (avatarCidPromise === 'none') return;
      if (typeof avatarCidPromise === 'string') return makeAvatarTexture(avatarCidPromise);
      if (avatarCidPromise) avatarCidPromise.priority += 1;
      else avatarCidPromise = avatarCids[user.shortDID] = avatarRequestQueue.eventually(user.shortDID, getAvatarCid);

      if (isPromise(avatarCidPromise)) avatarCidPromise.then(makeAvatarTexture);
      else makeAvatarTexture(avatarCidPromise);

      async function getAvatarCid() {
        try {
          outcome.avatarRequestCount++;

          const plc = await fetch(
            'https://plc.directory/' + unwrapShortDID(user.shortDID) + '/log/audit'
          ).then(x => x.json());
          let pds;
          for (const entry of plc.reverse()) {
            const endpoint = entry.operation.services?.atproto_pds?.endpoint;
            if (endpoint) {
              pds = endpoint;
              break;
            }
          }

          const data = await fetch(
            (pds || 'https://bsky.social') + '/xrpc/com.atproto.repo.listRecords?' +
            'repo=' + unwrapShortDID(user.shortDID) + '&' +
            'collection=app.bsky.actor.profile').then(x => x.json());

          let avatarCid = /** @type {*} */(data.records?.[0]?.value)?.avatar?.ref?.$link;
          if (!avatarCid) avatarCid = 'none';
          else avatarRequestSuccesses++;
          if (typeof avatarCids[user.shortDID] !== 'string' && avatarCid !== 'none') outcome.allCachedAvatars++;
          avatarCids[user.shortDID] = avatarCid;
          outcome.avatarRequestCount--;
          return avatarCid;
        } catch (avatarReqError) {
          avatarRequestFailures++;
          outcome.avatarRequestCount--;
          return 'none';
        }
      }

      /** @param {string} avatarCid  */
      async function makeAvatarTexture(avatarCid) {
        if (disposed) return;
        if (!avatarCid || avatarCid === 'none') return;
        if (labelsByShortDID[user.shortDID]) return;

        const avatarUrl = 'https://bsky.social/xrpc/com.atproto.sync.getBlob?did=' + unwrapShortDID(user.shortDID) + '&cid=' + avatarCid;

        avatarTexture = await avatarTextureLoader.loadAsync(avatarUrl);
        if (disposed) return;

        outcome.avatarImages++;

        avatarMaterial = new MeshBasicMaterial({ map: avatarTexture, color: 0xffffff });
        avatarMaterial.transparent = true;
        avatarGeometry = new CircleGeometry(0.0014, 16);
        avatarMesh = new Mesh(avatarGeometry, avatarMaterial);
        avatarMesh.position.set(0.005, 0.00068, 0);
        text.text = text.text.slice(1);
        text.position.set(0.0065, 0.004, 0);
        text.sync();

        group.add(avatarMesh);
      }
    }
  }

  var lastUpdateTextLabelsMsec;

  /** @param {PerspectiveCamera} camera */
  function updateWithCamera(camera) {
    const UPDATE_TEXT_LABELS_INTERVAL_MSEC = 2000;

    const cameraPos = camera.position;
    camera.updateMatrixWorld();

    for (const tileBucket of labelsByTiles) {
      if (!tileBucket) continue;
      let removeLabels;
      for (const label of tileBucket) {
        label.updateWithCamera(cameraPos);
        if (!label.visible && !label.fixed && label.animationEndsAtSec < clock.nowSeconds) {
          if (!removeLabels) removeLabels = [label];
          else removeLabels.push(label);
        }
      }

      if (removeLabels) {
        for (const label of removeLabels) {
          tileBucket.delete(label);
          layerGroup.remove(label.group);
          label.dispose();
          delete labelsByShortDID[label.user.shortDID];
        }
      }
    }

    if (!lastUpdateTextLabelsMsec || clock.nowMSec - lastUpdateTextLabelsMsec > UPDATE_TEXT_LABELS_INTERVAL_MSEC) {
      lastUpdateTextLabelsMsec = clock.nowMSec;

      refreshDynamicLabels(camera);
    }

  }

  /** @param {PerspectiveCamera} camera */
  function refreshDynamicLabels(camera) {
    let numberOfTests = 0;
    const testArgs = /** @type {Parameters<typeof nearestLabel<LabelInfo, { screenX: number, screenY: Number, visible?: boolean }>>[0]} */({
      tileDimensionCount,
      tileX: 0, tileY: 0, testLabel: { screenX: NaN, screenY: NaN },
      tiles: labelsByTiles,
      isCloseTo: (toLabel, testLabel) => {
        numberOfTests++;
        return Math.max(0, MIN_SCREEN_DISTANCE - labelsDistanceTo(toLabel, testLabel))
      },
      isVisible: (label) => label.visible
    });

    let labelOverflow = false;

    for (let xIndex = 0; xIndex < tileDimensionCount; xIndex++) {
      for (let yIndex = 0; yIndex < tileDimensionCount; yIndex++) {
        const tileIndex = xIndex + yIndex * tileDimensionCount;

        const allTileUsers = tiles[tileIndex];
        if (!allTileUsers) continue; // some tiles are empty (rectangular world, round galaxy)

        const tileLabels = labelsByTiles[tileIndex] || (labelsByTiles[tileIndex] = new Set());
        testArgs.tileX = xIndex;
        testArgs.tileY = yIndex;

        for (const existingLabel of tileLabels) {
          pBuf.set(existingLabel.user.x, existingLabel.user.h, existingLabel.user.y);
          pBuf.project(camera);
          existingLabel.screenX = pBuf.x;
          existingLabel.screenY = pBuf.y;

          if (existingLabel.fixed) continue;

          testArgs.testLabel = existingLabel;

          let shouldBeRemoved = nearestLabel(testArgs);
          if (shouldBeRemoved) {
            if (existingLabel.visible) {
              existingLabel.visible = false;
              const remainingFadeTime = existingLabel.animationEndsAtSec > clock.nowSeconds ?
                ANIMATE_LENGTH_SEC - (existingLabel.animationEndsAtSec - clock.nowSeconds) :
                ANIMATE_LENGTH_SEC;
              existingLabel.animationEndsAtSec = clock.nowSeconds + remainingFadeTime;
            }
          } else {
            if (!existingLabel.visible) {
              existingLabel.visible = true;
              const remainingFadeTime = existingLabel.animationEndsAtSec > clock.nowSeconds ?
                ANIMATE_LENGTH_SEC - (existingLabel.animationEndsAtSec - clock.nowSeconds) :
                ANIMATE_LENGTH_SEC;
              existingLabel.animationEndsAtSec = clock.nowSeconds + remainingFadeTime;
            }
          }
        }

        testArgs.testLabel = { screenX: NaN, screenY: NaN };
        for (const user of allTileUsers) {
          if (labelsByShortDID[user.shortDID]) continue;
          pBuf.set(user.x, user.h, user.y);
          pBuf.project(camera);

          testArgs.testLabel.screenX = pBuf.x;
          testArgs.testLabel.screenY = pBuf.y;

          if (nearestLabel(testArgs)) {
            break;
          } else {
            if (layerGroup.children.length > MAX_LABELS) {
              labelOverflow = true;
              break;
            }

            const label = createLabel(user);
            label.screenX = pBuf.x;
            label.screenY = pBuf.y;
            tileLabels.add(label);
            layerGroup.add(label.group);
          }
        }

        if (labelOverflow) break;
      }
      if (labelOverflow) break;
    }

    outcome.hitTestCount = numberOfTests;
  }

  /**
   * @param {LabelInfo} toLabel
   * @param {{ screenX: number, screenY: number }} testLabel
   */
  function labelsDistanceTo(toLabel, testLabel) {
    return distance2D(
      toLabel.screenX + (toLabel.textWidth || 0) * 0.8,
      toLabel.screenY + (toLabel.textHeight || 0) * 3,
      testLabel.screenX,
      testLabel.screenY);
  }
}