// @ts-check

import { BackSide, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial } from 'three';

/**
 * @template {{
 *  mass?: number,
 *  color?: number,
 *  start?: number,
 *  stop?: number
 * }} TParticle
 *
 * @param {{
 *  clock: { now(): number };
 *  comets: TParticle[],
 *  get: (
 *    spot: TParticle,
 *    start: { x: number, y: number, z: number, time: number, mass: number, color: number },
 *    stop: { x: number, y: number, z: number, time: number, mass: number, color: number },
 *    control: { x: number, y: number, z: number }
 *  ) => void
 * }} _ 
 */
export function massCometMesh({ clock: clockArg, comets, get }) {
  const clock = clockArg || { now: () => Date.now() };

  const start = { x: 0, y: 0, z: 0, time: 0, mass: 0, color: 0 };
  const stop = { x: 0, y: 0, z: 0, time: 0, mass: 0, color: 0 };
  const control = { x: 0, y: 0, z: 0 };

  const baseHalf = 1.5 * Math.tan(Math.PI / 6);
  let positions = new Float32Array([
    -baseHalf, 0, -0.5,
    0, 0, 1,
    baseHalf, 0, -0.5
  ]);

  let [
    offsetStartBuf,
    offsetStopBuf,
    offsetControlBuf,
    diameterStartStopBuf,
    timeStartStopBuf,
    colorStartStopBuf
  ] = allocateBuffers(comets.length);

  populateBuffers();

  let geometry = createGeometryAndAttributes();
  geometry.instanceCount = comets.length;

  const material = new ShaderMaterial({
    uniforms: {
      time: { value: clock.now() / 1000 }
    },
    vertexShader: /* glsl */`
            precision highp float;

            attribute vec3 offsetStart;
            attribute vec3 offsetStop;
            attribute vec3 offsetControl;

            attribute vec2 diameterStartStop;
            attribute vec2 timeStartStop;

            attribute uvec2 colorStartStop;

            uniform float time;

            varying vec3 vPosition;
            varying vec3 vOffset;
            varying float vDiameter;

            varying float vFogDist;
            varying vec4 vColor;

            varying float vTimeRatio;

            vec3 quadraticBezier(float t, vec3 startPoint, vec3 controlPoint, vec3 stopPoint) {
              float oneMinusT = 1.0 - t;
              return  oneMinusT * oneMinusT * startPoint + 2.0 * oneMinusT * t * controlPoint + t * t * stopPoint;
            }

            void main(){
              vPosition = position;

            float startTime = min(timeStartStop.x, timeStartStop.y);
            float endTime = max(timeStartStop.x, timeStartStop.y);
            vTimeRatio = (time - startTime) / (endTime - startTime);

            float distanceTimeFunction = sqrt(sqrt(vTimeRatio));

            vOffset = quadraticBezier(distanceTimeFunction, offsetStart, offsetControl, offsetStop);

            // DEBUG
            // vOffset = mix(offsetStart, offsetStop, vTimeRatio);
            // vOffset = offsetStart;

            uint rIntStart = (colorStartStop.x / uint(256 * 256 * 256)) % uint(256);
            uint gIntStart = (colorStartStop.x / uint(256 * 256)) % uint(256);
            uint bIntStart = (colorStartStop.x / uint(256)) % uint(256);
            uint aIntStart = (colorStartStop.x) % uint(256);
            vec4 colorStart = vec4(
              float(rIntStart) / 255.0f,
              float(gIntStart) / 255.0f,
              float(bIntStart) / 255.0f,
              float(aIntStart) / 255.0f);

            uint rIntStop = (colorStartStop.y / uint(256 * 256 * 256)) % uint(256);
            uint gIntStop = (colorStartStop.y / uint(256 * 256)) % uint(256);
            uint bIntStop = (colorStartStop.y / uint(256)) % uint(256);
            uint aIntStop = (colorStartStop.y) % uint(256);
            vec4 colorStop = vec4(
              float(rIntStop) / 255.0f,
              float(gIntStop) / 255.0f,
              float(bIntStop) / 255.0f,
              float(aIntStop) / 255.0f);

            vColor = mix(colorStart, colorStop, vTimeRatio);
            vDiameter = mix(diameterStartStop.x, diameterStartStop.y, vTimeRatio);

            // DEBUG?
            if (vTimeRatio > 1.0 || vTimeRatio < 0.0) {
              vDiameter = 0.0;
            }

            gl_Position = projectionMatrix * (modelViewMatrix * vec4(vOffset, 1) + vec4(position.xz * abs(vDiameter), 0, 0));

            vFogDist = distance(cameraPosition, vOffset);

          }
          `,
    fragmentShader: /* glsl */`
            precision highp float;

            uniform float time;

            varying vec3 vPosition;
            varying vec3 vOffset;
            varying float vDiameter;

            varying float vFogDist;
            varying vec4 vColor;

            varying float vTimeRatio;

            void main() {
              gl_FragColor = vColor;
              float dist = distance(vPosition, vec3(0.0));
              dist = vDiameter < 0.0 ? dist * 2.0 : dist;
              float rad = 0.25;
              float areola = rad * 2.0;
              float bodyRatio =
                dist < rad ? 1.0 :
                dist > areola ? 0.0 :
                (areola - dist) / (areola - rad);
              float radiusRatio =
                dist < 0.5 ? 1.0 - dist * 2.0 : 0.0;

              float fogStart = 0.6;
              float fogGray = 1.0;
              float fogRatio = vFogDist < fogStart ? 0.0 : vFogDist > fogGray ? 1.0 : (vFogDist - fogStart) / (fogGray - fogStart);

              vec4 tintColor = vColor;
              tintColor.a = radiusRatio;
              gl_FragColor = mix(gl_FragColor, vec4(1.0,1.0,1.0,0.7), fogRatio * 0.7);
              gl_FragColor = vDiameter < 0.0 ? vec4(0.6,0.0,0.0,1.0) : gl_FragColor;
              gl_FragColor.a = bodyRatio;

              vec3 position = vPosition;

              gl_FragColor = tintColor;

              float stepIn = 0.05;
              float stepOut = 0.01;
              float timeFunction =
                vTimeRatio < stepIn ? vTimeRatio / stepIn :
                1.0 - vTimeRatio < stepOut ? (vTimeRatio - 1.0) / stepOut :
                1.0;

              gl_FragColor = tintColor;

              gl_FragColor.a *= timeFunction;

              // vec2 posR = vec2(vPosition.x, vPosition.z);
              // float angle = vTimeRatio * 3.14159 * 2.0;
              // mat2 rotationMatrix = mat2(
              //   cos(angle), -sin(angle),
              //   sin(angle), cos(angle)
              // );
              // vec2 posRotated = rotationMatrix * posR;

              float diagBias = 1.0 - max(abs(vPosition.x), abs(vPosition.z));
              float diagBiasUltra = diagBias * diagBias * diagBias * diagBias;
              gl_FragColor.a *= diagBiasUltra * diagBiasUltra * diagBiasUltra;

              // DEBUG
              // gl_FragColor = vec4(mix(1.0, 0.0, vTimeRatio), 0.0, mix(0.0, 1.0, vTimeRatio), 1.0);
              // gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);

            }
          `,
    side: BackSide,
    forceSinglePass: true,
    transparent: true,
    depthWrite: false
  });

  const mesh = new Mesh(geometry, material);

  // seems to serve no purpose, but might slow things, let's cut it out for now
  // mesh.frustumCulled = false;

  mesh.onBeforeRender = () => {
    material.uniforms['time'].value = clock.now() / 1000;
  };

  const meshWithUpdates =
    /** @type {typeof mesh & { updateComets: typeof updateComets }} */(
      mesh
    );
  meshWithUpdates.updateComets = updateComets;

  return meshWithUpdates;

  function createGeometryAndAttributes() {
    const geometry = new InstancedBufferGeometry();
    // this one never changes
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));

    // these are instanced: one set of values per comet
    geometry.setAttribute('offsetStart', new InstancedBufferAttribute(offsetStartBuf, 3));
    geometry.setAttribute('offsetStop', new InstancedBufferAttribute(offsetStopBuf, 3));
    geometry.setAttribute('offsetControl', new InstancedBufferAttribute(offsetControlBuf, 3));
    geometry.setAttribute('diameterStartStop', new InstancedBufferAttribute(diameterStartStopBuf, 2));
    geometry.setAttribute('timeStartStop', new InstancedBufferAttribute(timeStartStopBuf, 2));
    geometry.setAttribute('colorStartStop', new InstancedBufferAttribute(colorStartStopBuf, 2))

    return geometry;
  }

  /** @param {number} count */
  function allocateBuffers(count) {
    const offsetStartBuf = new Float32Array(count * 3);
    const offsetStopBuf = new Float32Array(count * 3);
    const offsetControlBuf = new Float32Array(count * 3);

    const diameterStartStopBuf = new Float32Array(count * 2);
    const timeStartStopBuf = new Float32Array(count * 2);
    const colorStartStopBuf = new Uint32Array(count * 2);

    return [
      offsetStartBuf,
      offsetStopBuf,
      offsetControlBuf,
      diameterStartStopBuf,
      timeStartStopBuf,
      colorStartStopBuf
    ];
  }

  function zeroEndPoint(p) {
    p.x = 0;
    p.y = 0;
    p.z = 0;
    p.time = 0;
    p.mass = 0;
    p.color = 0;
  }

  function zeroControlPoint(p) {
    p.x = 0;
    p.y = 0;
    p.z = 0;
  }

  function populateBuffers() {
    for (let i = 0; i < comets.length; i++) {
      const spot = comets[i];

      // reset the dummy object
      zeroEndPoint(start);
      zeroEndPoint(stop);
      zeroControlPoint(control);

      if (typeof get === 'function') get(spot, start, stop, control);

      offsetStartBuf[i * 3 + 0] = start.x;
      offsetStartBuf[i * 3 + 1] = start.y;
      offsetStartBuf[i * 3 + 2] = start.z;

      offsetStopBuf[i * 3 + 0] = stop.x;
      offsetStopBuf[i * 3 + 1] = stop.y;
      offsetStopBuf[i * 3 + 2] = stop.z;

      offsetControlBuf[i * 3 + 0] = control.x;
      offsetControlBuf[i * 3 + 1] = control.y;
      offsetControlBuf[i * 3 + 2] = control.z;

      diameterStartStopBuf[i + 0] = start.mass;
      diameterStartStopBuf[i + 1] = stop.mass;

      colorStartStopBuf[i + 0] = start.color;
      colorStartStopBuf[i + 1] = stop.color;

      timeStartStopBuf[i * 2 + 0] = start.time;
      timeStartStopBuf[i * 2 + 1] = stop.time;
    }
  }

  /**
* @param {TParticle[]} newSpots
*/
  function updateComets(newSpots) {
    comets = newSpots;
    if (newSpots.length > geometry.instanceCount || Math.max(320, newSpots.length) < geometry.instanceCount / 2) {
      const newAllocateCount = Math.max(
        Math.floor(newSpots.length * 1.5),
        newSpots.length + 300);

      [
        offsetStartBuf,
        offsetStopBuf,
        offsetControlBuf,
        diameterStartStopBuf,
        timeStartStopBuf,
        colorStartStopBuf
      ] = allocateBuffers(comets.length);

      populateBuffers();

      const oldGeometry = geometry;

      geometry = createGeometryAndAttributes();
      geometry.instanceCount = newAllocateCount;

      mesh.geometry = geometry;

      oldGeometry.dispose();
    } else {
      populateBuffers();

      geometry.attributes['offsetStart'].needsUpdate = true;
      geometry.attributes['offsetStop'].needsUpdate = true;
      geometry.attributes['offsetControl'].needsUpdate = true;
      geometry.attributes['diameterStartStop'].needsUpdate = true;
      geometry.attributes['timeStartStop'].needsUpdate = true;
      geometry.attributes['colorStartStop'].needsUpdate = true;
    }
  }

}