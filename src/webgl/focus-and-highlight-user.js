// @ts-check

import { Camera, Color, CylinderGeometry, Group, Mesh, MeshLambertMaterial, Scene, SphereGeometry } from 'three';
import { Text as troika_Text } from 'troika-three-text';

import { distance2D } from '../geometry/distance';
import { rndUserColorer } from '../colors/rnd-user-colorer';

/** @type {{ highlight(), dispose(), shortDID: string }[]} */
var higlightUserStack;
/**
 * @param {{
 *  shortDID: string,
 *  users: { [shortDID: string]: import('..').UserEntry },
 *  scene: Scene,
 *  camera: Camera,
 *  moveAndPauseRotation: (coord: {x: number, y: number, h: number}, towards: {x: number, y: number, h: number}) => void
 * }} _param
 */
export function focusAndHighlightUser({ shortDID, users, scene, camera, moveAndPauseRotation }) {
  const MAX_HIGHLIGHT_COUNT = 25;
  while (higlightUserStack?.length > MAX_HIGHLIGHT_COUNT) {
    const early = higlightUserStack.shift();
    early?.dispose?.();
  }

  const existingEntry = higlightUserStack?.find(entry => entry.shortDID === shortDID);
  if (existingEntry) {
    existingEntry.highlight();
    return;
  }

  const user = users[shortDID];
  const r = distance2D(user.x, user.y, 0, 0);
  const angle = Math.atan2(user.y, user.x);
  const xPlus = (r + 0.09) * Math.cos(angle);
  const yPlus = (r + 0.09) * Math.sin(angle);
  const hPlus = user.h + 0.04;

  const userColor = rndUserColorer(shortDID);

  const material = new MeshLambertMaterial({
    color: userColor,
    transparent: true,
    opacity: 0.9,
    // emissive: userColor,
  });
  const stem = new CylinderGeometry(0.0005, 0.00001, 0.001);
  const ball = new SphereGeometry(0.002);
  const stemMesh = new Mesh(stem, material);
  const ballMesh = new Mesh(ball, material);
  stemMesh.position.set(user.x, user.h + 0.0062, user.y);
  stemMesh.scale.set(1, 11.5, 1);

  ballMesh.position.set(user.x, user.h + 0.0136, user.y);
  scene.add(stemMesh);
  scene.add(ballMesh);

  const handleText = new troika_Text();
  handleText.text = '@' + user.shortHandle;
  handleText.fontSize = 0.01;
  handleText.color = userColor;
  handleText.outlineWidth = 0.0005;
  handleText.outlineBlur = 0.005;
  handleText.position.set(-0.005, 0.03, 0);
  handleText.onAfterRender = () => {
    applyTextBillboarding();
  };

  const group = new Group();
  group.position.set(user.x, user.h, user.y);
  group.add(/** @type {*} */(handleText));

  const displayNameText = user.displayName ? new troika_Text() : undefined;
  if (displayNameText) {
    displayNameText.text = /** @type {string} */(user.displayName);
    displayNameText.fontSize = 0.004;
    const co = new Color(userColor);
    co.offsetHSL(0, 0, 0.15);
    displayNameText.color = co.getHex();
    displayNameText.outlineWidth = 0.0003;
    displayNameText.outlineBlur = 0.005;
    displayNameText.position.set(0.005, 0.017, 0.0001);
    displayNameText.fontWeight = /** @type {*} */(200);
    group.add(/** @type {*} */(displayNameText));
  }

  scene.add(group);
  handleText.sync();
  if (displayNameText) displayNameText.sync();

  highlightUser();

  if (!higlightUserStack) higlightUserStack = [{ shortDID, dispose: unhighlightUser, highlight: highlightUser }];
  else higlightUserStack.push({ shortDID, dispose: unhighlightUser, highlight: highlightUser });

  function applyTextBillboarding() {
    group.rotation.y = Math.atan2(
      (camera.position.x - group.position.x),
      (camera.position.z - group.position.z));
    handleText.sync();
  }

  function highlightUser() {
    moveAndPauseRotation({ x: xPlus, y: yPlus, h: hPlus }, user);
  }

  function unhighlightUser() {
    scene.remove(group);
    handleText.dispose();

    scene.remove(stemMesh);
    scene.remove(ballMesh);
    material.dispose();
    stem.dispose();
    ball.dispose();

          /** @type {*} */(focusAndHighlightUser).unhighlightUser = undefined;
  }
}