// @ts-check

import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';

const WIDTH = 51;
const HEIGHT = 7;


// Initialize scene, camera, renderer (outside init)
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 2;
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Initialize GPUComputationRenderer (outside init)
const gpuCompute = new GPUComputationRenderer(WIDTH, HEIGHT, renderer);

const positionTexture = gpuCompute.createTexture();
for (let i = 0; i < WIDTH * HEIGHT * 4; i += 4) {
  const data = positionTexture.image.data;
  data[i] = Math.random() - 0.5; // x
  data[i] *= data[i] * data[i];
  data[i + 1] = Math.random() - 0.5; // y
  data[i + 1] *= data[i + 1] * data[i + 1];
  data[i + 2] = 0; // z
  data[i + 3] = 1; // alpha
}

const positionShader = /*glsl*/`
uniform float time;
uniform sampler2D positionTexture;
void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  uv = texture2D(positionTexture, uv).xy;

  float angle = 0.5 * time + uv.x * 10.0;
  float radius = 0.01 + uv.y * 3.8;
  gl_FragColor = vec4(radius * cos(angle), radius * sin(angle), 0.0, 1.0);
}
`;

const positionVariable = gpuCompute.addVariable("texturePosition", positionShader, positionTexture);
gpuCompute.setVariableDependencies(positionVariable, [positionVariable]);

positionVariable.material.uniforms.time = { value: 0 };
positionVariable.material.uniforms.positionTexture = { value: positionTexture };

gpuCompute.init();

// Initialize geometry and material (outside init)
const geometry = new THREE.PlaneGeometry(1, 1.5, WIDTH, HEIGHT);
const material = new THREE.ShaderMaterial({
  uniforms: { positionTexture: { value: null }, size: { value: 0.01 } },
  vertexShader: /*glsl*/`
uniform sampler2D positionTexture;
uniform float size;
void main() {
  vec4 pos = texture2D(positionTexture, uv);
  gl_PointSize = size;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos.xy, 0.0, 1.0);
  }
    `,
  fragmentShader: /*glsl*/`
        void main() {
            gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
        }
    `
});

const mesh = new THREE.Points(geometry, material);
scene.add(mesh);

renderer.setAnimationLoop(() => {
  positionVariable.material.uniforms.time.value += 0.01;
  // positionVariable.material.uniforms.positionTexture.value = positionVariable.renderTargets[1].texture;
  gpuCompute.compute();
  mesh.material.uniforms.positionTexture.value = positionVariable.renderTargets[0].texture;
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}, false);
