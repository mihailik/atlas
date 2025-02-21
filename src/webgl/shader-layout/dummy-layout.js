// @ts-check

import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';

const PARTICLE_COUNT = 128;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 2;
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Initialize GPUComputationRenderer (outside init)1
const gpuCompute = new GPUComputationRenderer(PARTICLE_COUNT, 1, renderer);

const positionTexture = gpuCompute.createTexture();
for (let i = 0; i < PARTICLE_COUNT * 4; i += 4) {
  const data = positionTexture.image.data;
  data[i] = Math.random() - 0.5; // x
  data[i] *= data[i] * data[i];
  data[i + 1] = Math.random() - 0.5; // y
  data[i + 1] *= data[i + 1] * data[i + 1];
  data[i + 2] = Math.random() - 0.5; // z
  data[i + 3] = Math.random() - 0.5; // alpha
}

const positionShader = /*glsl*/`
uniform float time;
uniform float delta;
uniform sampler2D positionTexture;
void main() {
  vec4 uv = texture2D(positionTexture, gl_FragCoord.xy / resolution);
  float angle = atan(uv.y, uv.x);
  float radius = length(uv.xy);
  uv.x = radius * cos(angle + delta * 0.003);
  uv.y = radius * sin(angle + delta * 0.003);

  gl_FragColor =uv;
}
`;

const positionVariable = gpuCompute.addVariable("texturePosition", positionShader, positionTexture);
gpuCompute.setVariableDependencies(positionVariable, [positionVariable]);

var worldStartTime = performance.now();
positionVariable.material.uniforms.time = { value: 0 };
positionVariable.material.uniforms.delta = { value: 0 };
positionVariable.material.uniforms.positionTexture = { value: positionTexture };

gpuCompute.init();

const geometry = new THREE.PlaneGeometry(3, 5.5, PARTICLE_COUNT, 1);
const material = new THREE.ShaderMaterial({
  uniforms: { positionTexture: { value: null }, size: { value: 0.01 } },
  vertexShader: /*glsl*/`
uniform sampler2D positionTexture;
uniform float size;
void main() {
  vec4 pos = texture2D(positionTexture, uv);
  gl_PointSize = size;
  gl_Position = projectionMatrix * modelViewMatrix * pos;
  gl_Position.z = 0.0;
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

/** we will extract the data back once in a while */
const floatData = new Float32Array(PARTICLE_COUNT * 4);
let nextExtract = worldStartTime + 1000;
let totalReadTime = 0;
let readCount = 0;

renderer.setAnimationLoop(() => {
  const now = performance.now() - worldStartTime;
  const deltaAbs = now - positionVariable.material.uniforms.time.value;
  positionVariable.material.uniforms.delta.value = deltaAbs;
  positionVariable.material.uniforms.time.value = now;
  positionVariable.material.uniforms.positionTexture.value = gpuCompute.getCurrentRenderTarget(positionVariable).texture;
  gpuCompute.compute();
  mesh.material.uniforms.positionTexture.value = gpuCompute.getCurrentRenderTarget(positionVariable).texture;
  renderer.render(scene, camera);

  if (now >= nextExtract) {
    // 2. Read the floating-point data from the render target
    const startReading = performance.now();
    renderer.readRenderTargetPixels(positionVariable.renderTargets[0], 0, 0, PARTICLE_COUNT, 1, floatData); // No need for transcoding!
    const readTime = performance.now() - startReading;

    totalReadTime += readTime;
    readCount++;

    console.log('read floatData ', readTime, 'ms, avg', (totalReadTime / readCount), 'ms', floatData);

    nextExtract = now + 1000;
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}, false);
