// @ts-check

import { BackSide, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial } from 'three';

/**
 * @template {{
 *  x?: number,
 *  y?: number,
 *  z?: number,
 *  mass?: number,
 *  color?: number,
 *  start?: number,
 *  stop?: number
 * }} TParticle
 *
 * @param {{
 *  clock: { now(): number };
 *  flashes: TParticle[],
 *  get?: (fash: TParticle, coords: { x: number, y: number, z: number, mass: number, color: number, start: number, stop: number }) => void
 * }} _ 
 */
export function massFlashMesh({ clock: clockArg, flashes, get }) {
  const clock = clockArg || { now: () => Date.now() };

  const dummy = {
    x: 0,
    y: 0,
    z: 0,
    mass: 0,
    color: 0,
    start: 0,
    stop: 0
  };

  const baseHalf = 1.5 * Math.tan(Math.PI / 6);
  let positions = new Float32Array([
    -baseHalf, 0, -0.5,
    0, 0, 1,
    baseHalf, 0, -0.5
  ]);
  let offsetBuf = new Float32Array(flashes.length * 4);
  let diameterBuf = new Float32Array(flashes.length);
  let extraBuf = new Float32Array(flashes.length * 2);
  let colorBuf = new Uint32Array(flashes.length);

  populateBuffers();

  let geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('offset', new InstancedBufferAttribute(offsetBuf, 3));
  geometry.setAttribute('diameter', new InstancedBufferAttribute(diameterBuf, 1));
  geometry.setAttribute('extra', new InstancedBufferAttribute(extraBuf, 2));
  geometry.setAttribute('color', new InstancedBufferAttribute(colorBuf, 1));
  geometry.instanceCount = flashes.length;

  const material = new ShaderMaterial({
    uniforms: {
      time: { value: clock.now() / 1000 }
    },
    vertexShader: /* glsl */`
            precision highp float;

            attribute vec3 offset;
            attribute float diameter;
            attribute vec2 extra;
            attribute uint color;

            uniform float time;

            varying vec3 vPosition;
            varying vec3 vOffset;
            varying float vDiameter;
            varying vec2 vExtra;

            varying float vFogDist;
            varying vec4 vColor;

            void main(){
              vPosition = position;
              vOffset = offset;
              vDiameter = diameter;
              vExtra = extra;

              gl_Position = projectionMatrix * (modelViewMatrix * vec4(offset, 1) + vec4(position.xz * abs(diameter), 0, 0));

              // https://stackoverflow.com/a/22899161/140739
              uint rInt = (color / uint(256 * 256 * 256)) % uint(256);
              uint gInt = (color / uint(256 * 256)) % uint(256);
              uint bInt = (color / uint(256)) % uint(256);
              uint aInt = (color) % uint(256);
              vColor = vec4(float(rInt) / 255.0f, float(gInt) / 255.0f, float(bInt) / 255.0f, float(aInt) / 255.0f);

              vFogDist = distance(cameraPosition, offset);

              // this part was kept separate before:
            float startTime = min(extra.x, extra.y);
            float endTime = max(extra.x, extra.y);
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
            varying vec2 vExtra;

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
              vec2 extra = vExtra;


              // this part was kept separate before:

            gl_FragColor = tintColor;

            float PI = 3.1415926535897932384626433832795;

            float startTime = min(extra.x, extra.y);
            float endTime = max(extra.x, extra.y);
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
    /** @type {typeof mesh & { updateFlashes: typeof updateFlashes }} */(
      mesh
    );
  meshWithUpdates.updateFlashes = updateFlashes;

  return meshWithUpdates;

  function populateBuffers() {
    for (let i = 0; i < flashes.length; i++) {
      const flash = flashes[i];

      // reset the dummy object
      dummy.x = flash.x || 0;
      dummy.y = flash.z || 0;
      dummy.z = flash.y || 0;
      dummy.mass = flash.mass || 0;
      dummy.color = flash.color || 0;
      dummy.start = flash.start || 0;
      dummy.stop = flash.stop || 0;

      if (typeof get === 'function') get(flash, dummy);

      offsetBuf[i * 3 + 0] = dummy.x;
      offsetBuf[i * 3 + 1] = dummy.y;
      offsetBuf[i * 3 + 2] = dummy.z;
      diameterBuf[i] = dummy.mass;
      colorBuf[i] = dummy.color;
      extraBuf[i * 2 + 0] = dummy.start;
      extraBuf[i * 2 + 1] = dummy.stop;
    }
  }

  /**
* @param {TParticle[]} newFlashes
*/
  function updateFlashes(newFlashes) {
    flashes = newFlashes;
    if (newFlashes.length > geometry.instanceCount || newFlashes.length < Math.max(320, geometry.instanceCount / 2)) {
      const newAllocateCount = Math.max(
        Math.floor(newFlashes.length * 1.5),
        newFlashes.length + 300);

      offsetBuf = new Float32Array(newAllocateCount * 4);
      diameterBuf = new Float32Array(newAllocateCount);
      extraBuf = new Float32Array(newAllocateCount * 2);
      colorBuf = new Uint32Array(newAllocateCount);

      populateBuffers();

      const oldGeometry = geometry;

      geometry = new InstancedBufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.setAttribute('offset', new InstancedBufferAttribute(offsetBuf, 3));
      geometry.setAttribute('diameter', new InstancedBufferAttribute(diameterBuf, 1));
      geometry.setAttribute('extra', new InstancedBufferAttribute(extraBuf, 2));
      geometry.setAttribute('color', new InstancedBufferAttribute(colorBuf, 1));
      geometry.instanceCount = newAllocateCount;

      mesh.geometry = geometry;

      oldGeometry.dispose();
    } else {
      populateBuffers();

      geometry.attributes['offset'].needsUpdate = true;
      geometry.attributes['diameter'].needsUpdate = true;
      geometry.attributes['extra'].needsUpdate = true;
      geometry.attributes['color'].needsUpdate = true;
    }
  }

}