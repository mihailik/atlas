// @ts-check

import { BackSide, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial } from 'three';

/**
 * @param {{
 *  clock: ReturnType<typeof import('./clock').makeClock>;
 *  userCount: number;
 *  fragmentShader?: string;
 *  vertexShader?: string;
 * }} _ 
 */
export function dynamicShaderRenderer({ clock, userCount, fragmentShader, vertexShader }) {
  const baseHalf = 1.5 * Math.tan(Math.PI / 6);
  let positions = new Float32Array([
    -baseHalf, 0, -0.5,
    0, 0, 1,
    baseHalf, 0, -0.5
  ]);
  let offsetBuf = new Float32Array(userCount * 4);
  let diameterBuf = new Float32Array(userCount);
  let extraBuf = new Float32Array(userCount * 2);
  let colorBuf = new Uint32Array(userCount);


  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('offset', new InstancedBufferAttribute(offsetBuf, 3));
  geometry.setAttribute('diameter', new InstancedBufferAttribute(diameterBuf, 1));
  geometry.setAttribute('extra', new InstancedBufferAttribute(extraBuf, 2));
  geometry.setAttribute('color', new InstancedBufferAttribute(colorBuf, 1));
  geometry.instanceCount = userCount;

  const material = new ShaderMaterial({
    uniforms: {
      time: { value: clock.nowSeconds }
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

              ${vertexShader || ''}
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

              ${fragmentShader || ''}
            }
          `,
    side: BackSide,
    forceSinglePass: true,
    transparent: true,
    depthWrite: false
  });

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.onBeforeRender = () => {
    material.uniforms['time'].value = clock.nowSeconds;
  };
  return { mesh, updateUserSet };

  /**
   * @param {{ user: import('..').UserEntry, weight: number, start: number, stop: number }[]} users
   */
  function updateUserSet(users) {
    for (let i = 0; i < users.length; i++) {
      const { user, weight, start, stop } = users[i];
      offsetBuf[i * 3 + 0] = user.x;
      offsetBuf[i * 3 + 1] = user.h;
      offsetBuf[i * 3 + 2] = user.y;
      diameterBuf[i] = weight || user.weight;
      colorBuf[i] = user.colorRGB * 256 | 0xFF;
      extraBuf[i * 2 + 0] = start;
      extraBuf[i * 2 + 1] = stop;
    }

    geometry.attributes['offset'].needsUpdate = true;
    geometry.attributes['diameter'].needsUpdate = true;
    geometry.attributes['color'].needsUpdate = true;
    geometry.attributes['extra'].needsUpdate = true;

    geometry.instanceCount = users.length;
  }
}