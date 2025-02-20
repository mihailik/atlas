// @ts-check

var DEFAULT_GRAVITY = 9.8;

/**
 * @template {{
 *  x?: number,
 *  y?: number,
 *  z?: number,
 *  mass?: number,
 * }} TParticle
 *
 * @param {{
 *  clock?: { now(): number },
 *  gravity?: number,
 *  particles: TParticle[],
 *  get?: (particle: TParticle, coords: { x: number, y: number, z: number, mass: number }) => void
 * }} _ 
 */
export function runBasicShader({ clock: clockArg, gravity, particles, get }) {

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 is not supported by this browser.');
  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) throw new Error('Floating point textures are required in the current implementation.');


  let [width, height] = fitDimensions(particles.length);

  let positions = new Float32Array(width * height * 3);
  let masses = new Float32Array(width * height);

  const positionsReadTexture = glCreateRGB32FTexture({ gl, width, height, data: positions });
  const positionsWriteTexture = glCreateRGB32FTexture({ gl, width, height, data: null });

  const massesTexture = glCreateR32FTexture({ gl, width, height, data: masses });

  const velocitiesReadTexture = glCreateRGB32FTexture({ gl, width, height, data: null });
  const velocitiesWriteTexture = glCreateRGB32FTexture({ gl, width, height, data: null });

  const program = glProgram(
    gl,
/* glsl */`#version 300 es
precision highp float;
uniform sampler2D positionsTexture;
uniform sampler2D massesTexture;
uniform sampler2D velocitiesTexture;

out vec4 newVelocity;
out vec4 newPosition;

void main() {
  float gravity = ${(gravity || DEFAULT_GRAVITY).toFixed(16)};
  vec3 position = texelFetch(positionsTexture, ivec2(gl_FragCoord.x, gl_FragCoord.y), 0).xyz;
  float mass = texelFetch(massesTexture, ivec2(gl_FragCoord.x, gl_FragCoord.y), 0).x;
  vec3 velocity = texelFetch(velocitiesTexture, ivec2(gl_FragCoord.x, gl_FragCoord.y), 0).xyz;

  float totalForce = 0.0;

// Iterate through all other particles (brute force O(n^2))
  for (int iX = 0; iX < ${width}; iX++) {
    for (int iY = 0; iY < ${height}; iY++) {
      ivec2 otherParticleCoord = ivec2(iX, iY); // Calculate coordinates in position texture
      vec3 otherPosition = texelFetch(positionsTexture, otherParticleCoord, 0).xyz;
      float otherMass = texelFetch(massesTexture, otherParticleCoord, 0).x;

      if (gl_FragCoord.x == otherParticleCoord.x && gl_FragCoord.y == otherParticleCoord.y) continue; // Skip self-interaction

      vec3 direction = otherPosition - position;
      float distance = length(direction);

      // Avoid division by zero (or very small distance)
      if (distance > ${Number.EPSILON.toFixed(16)}) { // Or a small epsilon value
        float forceMagnitude = gravity * mass * otherMass / (distance * distance);
        vec3 force = normalize(direction) * forceMagnitude;
        totalForce += force;
      }
    }
  }

  // Update velocity (assuming delta time = 1.0 for simplicity.  You'll need to use a proper delta time in your real application)
  newVelocity = velocity + totalForce / mass; // a = F/m

  // Calculate new position using explicit Euler integration (simplest method)
  newPosition = vec4(position + velocity * 1.0, 1.0);
}
`
  );

  // framebuffer (tied to output texture)
  const velocityCalcFrameBuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, velocityCalcFrameBuffer);







  
  gl.useProgram(program);

  gl.activeTexture(gl.TEXTURE0); // Activate texture unit 0
  gl.bindTexture(gl.TEXTURE_2D, positionsReadTexture); // Bind your position texture to the active unit (TEXTURE0)
  gl.uniform1i(gl.getUniformLocation(program, "positionsTexture"), 0);

  gl.activeTexture(gl.TEXTURE1); // Activate texture unit 1
  gl.bindTexture(gl.TEXTURE_2D, massesTexture); // Bind your mass texture to the active unit (TEXTURE1)
  gl.uniform1i(gl.getUniformLocation(program, "massesTexture"), 1);

  gl.activeTexture(gl.TEXTURE2); // Activate texture unit 2
  gl.bindTexture(gl.TEXTURE_2D, velocitiesReadTexture); // Bind your velocity texture to the active unit (TEXTURE2)
  gl.uniform1i(gl.getUniformLocation(program, "velocitiesTexture"), 2);

  // do the frame buffer
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0, // vary for multi-target rendering
    gl.TEXTURE_2D,
    velocitiesWriteTexture, // <--
    0); // no mipmap

  // verify framebuffer is OK
  const frStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (frStatus !== gl.FRAMEBUFFER_COMPLETE)
    throw new Error("Velocities framebuffer: framebufferTexture2D " + Object.keys(Object.getPrototypeOf(gl)).find(k => gl[k] == frStatus));

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // Draw the quad










  // let's allocate space to read the output texture
  const results = new Float32Array(data.length);
  results[0] = 1; results[1] = 2; // inject dummies to see if they're overridden
  gl.readPixels(0, 0, data.length, 1, gl.RED, gl.FLOAT, results);

  // releasing the resources
  // (do this only when you're done with the whole setup)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteTexture(inputTexture);
  gl.deleteTexture(outputTexture);
  gl.deleteFramebuffer(velocityCalcFrameBuffer);
  gl.deleteProgram(program);

  [
    [...results].slice(0, 8),
    '...',
    [...results].slice(-8)
  ];

}

/**
 * @param {{
 *  gl: WebGL2RenderingContext,
 *  width: number,
 *  height: number,
 *  data?: Float32Array | null
 * }} _
 */
function glCreateR32FTexture({ gl, data, width, height }) {
  const inputTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, inputTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data || null);
  return inputTexture;
}

/**
 * @param {{
 *  gl: WebGL2RenderingContext,
 *  width: number,
 *  height: number,
 *  data?: Float32Array | null
 * }} _
 */
function glCreateRGB32FTexture({ gl, data, width, height }) {
  const inputTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, inputTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, width, height, 0, gl.RGB, gl.FLOAT, data || null);
  return inputTexture;
}

/** 
 * @param {WebGL2RenderingContext} gl
 * @param {string} fragmentShader
 */
function glProgram(gl, fragmentShader) {
  // vertex shader: fixed set of positions to cover the viewport
  const vs = gl.createShader(gl.VERTEX_SHADER);
  if (!vs) throw new Error('Failed to create vertex shader.');
  gl.shaderSource(vs,
    `#version 300 es
void main() {
  if (gl_VertexID == 0) gl_Position = vec4(-1.0, -1.0 /* ↙ */, 0.0, 1.0);
  else if (gl_VertexID == 1) gl_Position = vec4(1.0, -1.0 /* ↘ */, 0.0, 1.0);
  else if (gl_VertexID == 2) gl_Position = vec4(-1.0, 1.0 /* ↖ */, 0.0, 1.0);
  else gl_Position = vec4(1.0, 1.0 /* ↗ */, 0.0, 1.0);
}
`);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    gl.deleteShader(vs); // Delete shader on error
    throw new Error("Vertex shader compilation error " + gl.getShaderInfoLog(vs));
  }

  // fragment shader:
  //   fetching corresponding pixel from texture, then multiplying by *2.0
  //   (only red channel has value, per R32F format above)
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!fs) throw new Error('Failed to create fragment shader.');
  gl.shaderSource(fs, fragmentShader);
  if (!fs) throw new Error('Failed to create fragment shader.');
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    gl.deleteShader(fs); // Delete shader on error
    throw new Error("Fragment shader compilation error " + gl.getShaderInfoLog(fs));
  }


  // create program from vertext/fragment shader
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  gl.deleteShader(vs);
  gl.deleteShader(fs);

  // this helps with GLSL syntax errors
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error("WebGL program link error. " + gl.getProgramInfoLog(program));

  return program;
}

/** @param {number} num */
function fitDimensions(num) {
  const rt = Math.floor(Math.sqrt(num));
  if (rt * rt >= num) return [rt, rt];
  if (rt * (rt + 1) >= num) return [rt, rt + 1];
  else return [rt + 1, rt + 1];
}
