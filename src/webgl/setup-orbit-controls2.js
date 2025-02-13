// @ts-check

import { PerspectiveCamera, Plane, Raycaster, Scene, Vector2, Vector3 } from 'three';

  /**
   * @param {{
   *  camera: PerspectiveCamera,
   *  host: HTMLElement,
   *  clock: ReturnType<typeof import('./clock').makeClock>,
   * scene: Scene
   * }} _
   */
export function setupOrbitControls2({ camera, host, clock, scene }) {
    const STEADY_ROTATION_SPEED = 0.2;

    let controls = initControls();

    const outcome = {
      controls,
      rotating: true,
      pauseRotation,
      waitAndResumeRotation,
      moveAndPauseRotation
    };

    return outcome;

    var changingRotationInterval;

    function pauseRotation() {
      //if (controls.autoRotate) controls.autoRotate = false;

      outcome.rotating = false;
      clearInterval(changingRotationInterval);
    }

    function waitAndResumeRotation(resumeAfterWait) {
      const WAIT_BEFORE_RESUMING_MSEC = 10000;
      const SPEED_UP_WITHIN_MSEC = 10000;

      if (!resumeAfterWait) resumeAfterWait = WAIT_BEFORE_RESUMING_MSEC;

      clearInterval(changingRotationInterval);
      const startResumingRotation = clock.nowMSec;
      changingRotationInterval = setInterval(continueResumingRotation, 100);


      function continueResumingRotation() {
      }
    }

    /**
     * @param {{x: number, y: number, h: number }} xyh
     * @param {{x: number, y: number, h: number }} towardsXYH
     */
    function moveAndPauseRotation(xyh, towardsXYH) {
    }

    function initControls() {
      /**
       * @typedef {{
      *  start: Vector3,
      *  current?: Vector3,
      *  radius: number,
      *  id: number,
      *  isTouch: boolean,
      *  isAlternative: boolean
       * }} PointerInfo
       */
      /**
       * @type {PointerInfo[] & { center: Vector3 } | undefined}
       */
      let pointers;

      const tmpPoint2D = new Vector2();
      const floorPlane = new Plane(new Vector3(0, 0, 1), 0);
      const raycaster = new Raycaster();

      // host.addEventListener('touchstart', onTouchStart);
      // host.addEventListener('touchstart', onTouchStart);
      host.addEventListener('contextmenu', onContextMenu);

      host.addEventListener('pointerdown', handlePointerDown);
      host.addEventListener('pointercancel', handlePointerUp);
      host.addEventListener('pointermove', handlePointerMove);
      host.addEventListener('pointerup', handlePointerUp);

      host.addEventListener('wheel', onMouseWheel, { passive: false });

      /** @param {Event} event */
      function onContextMenu(event) {
        event.preventDefault();
      }

      /** @param {PointerEvent} event */
      function handlePointerDown(event) {
        if (!pointers?.length) {
          host.setPointerCapture(event.pointerId);
        }

        addPointer(
          event,
          event.pointerType === 'touch',
          event.button > 1 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
        );
      }

      /** @param {PointerEvent} event */
      function handlePointerUp(event) {
        removePointer(event);
        if (!pointers?.length) {
          host.releasePointerCapture(event.pointerId);
        }
      }

      /** @param {PointerEvent} event */
      function handlePointerMove(event) {
        const pointer = pointers?.find(p => p.id === event.pointerId);
        if (!pointer) return;

        pointer.current = convertScreenTo3D(event.clientX, event.clientY);

        onPointerMove();
      }

      /**
       * @param {number} clientX
       * @param {number} clientY
       */
      function convertScreenTo3D(clientX, clientY) {
        const screenX = (clientX / window.innerWidth) * 2 - 1;
        const screenY = -(clientY / window.innerHeight) * 2 + 1;
        tmpPoint2D.set(screenX, screenY);
        raycaster.setFromCamera(tmpPoint2D, camera);
        const intersections = raycaster.intersectObject(scene, true);
        if (!intersections?.length || intersections[0].distance > 0.001) {
          const intersect = new Vector3();
          raycaster.ray.intersectPlane(floorPlane, intersect);
          return intersect;
        }

        let bestIntersect = intersections[0];

        return bestIntersect.point;
      }

      /** @param {PointerEvent} event @param {boolean} isTouch @param {boolean} isAlternative */
      function addPointer(event, isTouch, isAlternative) {
        if (!pointers) {
          pointers = /** @type {PointerInfo[] & { center: Vector3 }} */(/** @type {*}*/([]));
          pointers.center = convertScreenTo3D(window.innerWidth / 2, window.innerHeight / 2);
        }

        pointers.push({
          start: convertScreenTo3D(event.clientX, event.clientY),
          radius: (event.width + event.height) / 2,
          id: event.pointerId,
          isTouch, isAlternative
        });
      }

      /** @param {PointerEvent} event */
      function removePointer(event) {
        if (!pointers) return;
        const index = pointers.findIndex(p => p.id === event.pointerId);
        pointers.splice(index, 1);
        if (!pointers.length) pointers = undefined;
      }

      /** @param {MouseEvent} event */
      function onMouseWheel(event) {

      }

      function onPointerMove() {
        if (!pointers?.length) return;

        if (pointers.length === 1) {
          if (!pointers[0].current) return;

          const isPan = pointers[0].isAlternative;
          if (isPan) {
            if (!pointers[0].current.x && !pointers[0].current.y && !pointers[0].current.z) return;
            if (pointers[0].current === pointers[0].start) return;
            const delta = pointers[0].current.clone().sub(pointers[0].start);
            const deltaLength = delta.length();
            const cameraDistanceStart = pointers[0].start.distanceTo(camera.position);
            const cameraDistanceCurrent = pointers[0].current.distanceTo(camera.position);
            const ratio = cameraDistanceCurrent / cameraDistanceStart;
            camera.position.sub(delta.multiplyScalar(deltaLength * Math.sqrt(ratio)));
          } else {

          }
        }
      }

    }
  }