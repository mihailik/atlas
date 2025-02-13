// @ts-check

import {
  BackSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial
} from 'three';

/**
 * @template {{ x?: number, y?: number, z?: number, mass?: number, color?: number }} TParticle
 * @param {{
 *  clock?: { now(): number },
 *  spots: TParticle[],
 *  get?: (spot: TParticle, coords: { x: number, y: number, z: number, mass: number, color: number }) => void
 * }} _ 
 */
export function massSpotMesh({ clock: clockArg, spots, get }) {
  const clock = clockArg || { now: () => Date.now() };

  const dummy = {
    x: 0,
    y: 0,
    z: 0,
    mass: 0,
    color: 0
  };

  const baseHalf = 1.5 * Math.tan(Math.PI / 6);
  let positions = new Float32Array([
    -baseHalf, 0, -0.5,
    0, 0, 1,
    baseHalf, 0, -0.5
  ]);
  let offsetBuf = new Float32Array(spots.length * 4);
  let diameterBuf = new Float32Array(spots.length);
  let colorBuf = new Uint32Array(spots.length);

  populateBuffers();

  let geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('offset', new InstancedBufferAttribute(offsetBuf, 3));
  geometry.setAttribute('diameter', new InstancedBufferAttribute(diameterBuf, 1));
  geometry.setAttribute('color', new InstancedBufferAttribute(colorBuf, 1));
  geometry.instanceCount = spots.length;

  const material = new ShaderMaterial({
    uniforms: {
      time: { value: clock.now() / 1000 }
    },
    vertexShader: /* glsl */`
            precision highp float;

            attribute vec3 offset;
            attribute float diameter;
            attribute uint color;

            uniform float time;

            varying vec3 vPosition;
            varying float vDiameter;

            varying float vFogDist;
            varying vec4 vColor;

            void main(){
              vPosition = position;
              vDiameter = diameter;

              gl_Position = projectionMatrix * (modelViewMatrix * vec4(offset, 1) + vec4(position.xz * abs(diameter), 0, 0));

              // https://stackoverflow.com/a/22899161/140739
              uint rInt = (color / uint(256 * 256 * 256)) % uint(256);
              uint gInt = (color / uint(256 * 256)) % uint(256);
              uint bInt = (color / uint(256)) % uint(256);
              uint aInt = (color) % uint(256);
              vColor = vec4(float(rInt) / 255.0f, float(gInt) / 255.0f, float(bInt) / 255.0f, float(aInt) / 255.0f);

              vFogDist = distance(cameraPosition, offset);
            }
          `,
    fragmentShader: /* glsl */`
            precision highp float;

            uniform float time;

            varying vec4 vColor;
            varying float vFogDist;

            varying vec3 vPosition;
            varying float vDiameter;

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

  function populateBuffers() {
    for (let i = 0; i < spots.length; i++) {
      const spot = spots[i];

      // reset the dummy object
      dummy.x = spot.x || 0;
      dummy.y = spot.z || 0;
      dummy.z = spot.y || 0;
      dummy.mass = spot.mass || 0;
      dummy.color = spot.color || 0;

      if (typeof get === 'function') get(spot, dummy);

      offsetBuf[i * 3 + 0] = dummy.x;
      offsetBuf[i * 3 + 1] = dummy.y;
      offsetBuf[i * 3 + 2] = dummy.z;
      diameterBuf[i] = dummy.mass;
      colorBuf[i] = dummy.color;
    }
  }

  /**
 * @param {TParticle[]} newSpots
 */
  function updateSpots(newSpots) {
    spots = newSpots;
    if (newSpots.length > geometry.instanceCount || newSpots.length < geometry.instanceCount / 2) {
      const newAllocateCount = Math.max(
        Math.floor(newSpots.length * 1.5),
        newSpots.length + 300);

      offsetBuf = new Float32Array(newAllocateCount * 4);
      diameterBuf = new Float32Array(newAllocateCount);
      colorBuf = new Uint32Array(newAllocateCount);

      populateBuffers();

      const oldGeometry = geometry;

      geometry = new InstancedBufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.setAttribute('offset', new InstancedBufferAttribute(offsetBuf, 3));
      geometry.setAttribute('diameter', new InstancedBufferAttribute(diameterBuf, 1));
      geometry.setAttribute('color', new InstancedBufferAttribute(colorBuf, 1));
      geometry.instanceCount = newAllocateCount;

      mesh.geometry = geometry;

      oldGeometry.dispose();
    } else {
      populateBuffers();

      geometry.attributes['offset'].needsUpdate = true;
      geometry.attributes['diameter'].needsUpdate = true;
      geometry.attributes['color'].needsUpdate = true;
    }
  }
}