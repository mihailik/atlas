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
 *    startControl: { x: number, y: number, z: number },
 *    stopControl: { x: number, y: number, z: number }
 *  ) => void
 * }} _ 
 */
export function massCometMesh({ clock: clockArg, comets, get }) {
  const clock = clockArg || { now: () => Date.now() };

  const start = { x: 0, y: 0, z: 0, time: 0, mass: 0, color: 0 };
  const stop = { x: 0, y: 0, z: 0, time: 0, mass: 0, color: 0 };
  const startControl = { x: 0, y: 0, z: 0 };
  const stopControl = { x: 0, y: 0, z: 0 };

  const baseHalf = 1.5 * Math.tan(Math.PI / 6);
  let positions = new Float32Array([
    -baseHalf, 0, -0.5,
    0, 0, 1,
    baseHalf, 0, -0.5
  ]);

  let [offsetBuf, diameterBuf, startStopBuf, colorBuf] = allocateBuffers(comets.length);

  populateBuffers();

  let geometry = createGeometryAndAttributes();
  geometry.instanceCount = comets.length;

  const material = new ShaderMaterial({
    uniforms: {
      time: { value: clock.now() / 1000 }
    },
    vertexShader: /* glsl */`
            precision highp float;

            attribute vec3 offset;
            attribute float diameter;
            attribute vec2 startStop;
            attribute uint color;

            uniform float time;

            varying vec3 vPosition;
            varying vec3 vOffset;
            varying float vDiameter;
            varying vec2 vStartStop;

            varying float vFogDist;
            varying vec4 vColor;

            void main(){
              vPosition = position;
              vOffset = offset;
              vDiameter = diameter;
              vStartStop = startStop;

              gl_Position = projectionMatrix * (modelViewMatrix * vec4(offset, 1) + vec4(position.xz * abs(diameter), 0, 0));

              // https://stackoverflow.com/a/22899161/140739
              uint rInt = (color / uint(256 * 256 * 256)) % uint(256);
              uint gInt = (color / uint(256 * 256)) % uint(256);
              uint bInt = (color / uint(256)) % uint(256);
              uint aInt = (color) % uint(256);
              vColor = vec4(float(rInt) / 255.0f, float(gInt) / 255.0f, float(bInt) / 255.0f, float(aInt) / 255.0f);

              vFogDist = distance(cameraPosition, offset);

              // this part was kept separate before:
            float startTime = min(startStop.x, startStop.y);
            float endTime = max(startStop.x, startStop.y);
            float timeRatio = (time - startTime) / (endTime - startTime);
            float step = 0.1;
            float timeFunction = timeRatio < step ? timeRatio / step : 1.0 - (timeRatio - step) * (1.0 - step);

            //gl_Position.y += timeFunction * timeFunction * timeFunction * 0.001;
            }
          `,
    fragmentShader: /* glsl */`
            precision highp float;

            uniform float time;

            varying vec4 vColor;
            varying float vFogDist;

            varying vec3 vPosition;
            varying vec3 vOffset;
            varying float vDiameter;
            varying vec2 vStartStop;

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
              vec3 offset = vOffset;
              float diameter = vDiameter;
              vec2 startStop = vStartStop;


              // this part was kept separate before:

            gl_FragColor = tintColor;

            float PI = 3.1415926535897932384626433832795;

            float startTime = min(startStop.x, startStop.y);
            float endTime = max(startStop.x, startStop.y);
            float timeRatio = (time - startTime) / (endTime - startTime);
            float step = 0.05;
            float timeFunction =
              timeRatio < step ? timeRatio / step :
              timeRatio < step * 2.0 ?
                (cos((step * 2.0 - timeRatio) * step * PI) + 1.0) / 4.5 + 0.7 :
                (1.0 - (timeRatio - step * 2.0)) / 2.5 + 0.2;

            gl_FragColor = tintColor;

            gl_FragColor.a *= timeFunction;

            // gl_FragColor =
            //   timeRatio > 1000.0 ? vec4(1.0, 0.7, 1.0, tintColor.a) :
            //   timeRatio > 1.0 ? vec4(1.0, 0.0, 1.0, tintColor.a) :
            //   timeRatio > 0.0 ? vec4(0.0, 0.5, 0.5, tintColor.a) :
            //   timeRatio == 0.0 ? vec4(0.0, 0.0, 1.0, tintColor.a) :
            //   timeRatio < 0.0 ? vec4(1.0, 0.0, 0.0, tintColor.a) :
            //   vec4(1.0, 1.0, 0.0, tintColor.a);

            float diagBias = 1.0 - max(abs(vPosition.x), abs(vPosition.z));
            float diagBiasUltra = diagBias * diagBias * diagBias * diagBias;
            gl_FragColor.a *= diagBiasUltra * diagBiasUltra * diagBiasUltra;

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
    /** @type {typeof mesh & { updateSpots: typeof updateSpots }} */(
      mesh
    );
  meshWithUpdates.updateSpots = updateSpots;

  return meshWithUpdates;

  function createGeometryAndAttributes() {
    const geometry = new InstancedBufferGeometry();
    // this one never changes
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));

    // these are instanced: one set of values per comet
    geometry.setAttribute('offset', new InstancedBufferAttribute(offsetBuf, 4 * 3));
    geometry.setAttribute('diameter', new InstancedBufferAttribute(diameterBuf, 2));
    geometry.setAttribute('startStop', new InstancedBufferAttribute(startStopBuf, 2));
    geometry.setAttribute('color', new InstancedBufferAttribute(colorBuf, 2))

    return geometry;
  }

  /** @param {number} count */
  function allocateBuffers(count) {
    const offsetBuf = new Float32Array(count * 4 * 3); // start, stop, startControl, stopControl - each x/y/z
    const diameterBuf = new Float32Array(count * 2); // start, stop
    const startStopBuf = new Float32Array(count * 2); // start, stop
    const colorBuf = new Uint32Array(count * 2); // start, stop
    return [offsetBuf, diameterBuf, startStopBuf, colorBuf];
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
      zeroControlPoint(startControl);
      zeroControlPoint(stopControl);

      if (typeof get === 'function') get(spot, start, stop, startControl, stopControl);

      offsetBuf[i * 3 + 0] = start.x;
      offsetBuf[i * 3 + 1] = start.y;
      offsetBuf[i * 3 + 2] = start.z;

      offsetBuf[i * 3 + 3] = stop.x;
      offsetBuf[i * 3 + 4] = stop.y;
      offsetBuf[i * 3 + 5] = stop.z;

      offsetBuf[i * 3 + 6] = startControl.x;
      offsetBuf[i * 3 + 7] = startControl.y;
      offsetBuf[i * 3 + 8] = startControl.z;

      offsetBuf[i * 3 + 9] = stopControl.x;
      offsetBuf[i * 3 + 10] = stopControl.y;
      offsetBuf[i * 3 + 11] = stopControl.z;

      diameterBuf[i + 0] = start.mass;
      diameterBuf[i + 1] = stop.mass;

      colorBuf[i + 0] = start.color;
      colorBuf[i + 1] = stop.color;

      startStopBuf[i * 2 + 0] = start.time;
      startStopBuf[i * 2 + 1] = stop.time;
    }
  }

  /**
* @param {TParticle[]} newSpots
*/
  function updateSpots(newSpots) {
    comets = newSpots;
    if (newSpots.length > geometry.instanceCount || newSpots.length < Math.max(320, geometry.instanceCount / 2)) {
      const newAllocateCount = Math.max(
        Math.floor(newSpots.length * 1.5),
        newSpots.length + 300);

      [offsetBuf, diameterBuf, startStopBuf, colorBuf] = allocateBuffers(comets.length);

      populateBuffers();

      const oldGeometry = geometry;

      geometry = createGeometryAndAttributes();
      geometry.instanceCount = newAllocateCount;

      mesh.geometry = geometry;

      oldGeometry.dispose();
    } else {
      populateBuffers();

      geometry.attributes['offset'].needsUpdate = true;
      geometry.attributes['diameter'].needsUpdate = true;
      geometry.attributes['startStop'].needsUpdate = true;
      geometry.attributes['color'].needsUpdate = true;
    }
  }

}