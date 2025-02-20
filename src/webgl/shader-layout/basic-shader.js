// @ts-check

function runBasicShader() {

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('this is not true');
  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) throw new Error('this is not trues');


  // vertex shader: fixed set of positions to cover the viewport
  const vs = gl.createShader(gl.VERTEX_SHADER);
  if (!vs) throw new Error('Vertex shader creation failed.');
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
  if (!fs) throw new Error('Fragment shader creation failed.');
  gl.shaderSource(fs,
    `#version 300 es
precision highp float;
uniform sampler2D inputTexture;
out vec4 fragColor; // Output as vec4 for RGBA

void main() {
    vec4 value = texelFetch(inputTexture, ivec2(gl_FragCoord.x, 0), 0);
    fragColor = value * value + 0.1;
    //fragColor = vec4(1.0, 0.5, 0.25, 0.125);
}
`);
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

  gl.useProgram(program);

  // the input texture wired to the variable in fragment shader
  // input data: incrementing sequence of 256 numbers
  const data = new Float32Array(256);
  for (let i = 0; i < data.length; i++) {
    data[i] = i; // Example: Linear values
  }

  // create input texture from the data
  const inputTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, inputTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, data.length, 1, 0, gl.RED, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const inputTextureLocation = gl.getUniformLocation(program, "inputTexture");


  // output texture
  const outputTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, outputTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, data.length, 1, 0, gl.RED, gl.FLOAT, null);

  // framebuffer (tied to output texture)
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0, // vary for multi-target rendering
    gl.TEXTURE_2D,
    outputTexture, // <--
    0); // no mipmap

  // verify framebuffer is OK
  const frStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (frStatus !== gl.FRAMEBUFFER_COMPLETE)
    throw new Error("framebufferTexture2D " + Object.keys(Object.getPrototypeOf(gl)).find(k => gl[k] == frStatus));

  // rendering into the framebuffer
  gl.activeTexture(gl.TEXTURE0); // Activate texture unit 0
  gl.bindTexture(gl.TEXTURE_2D, inputTexture); // Bind your input texture

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
  gl.deleteFramebuffer(fb);
  gl.deleteProgram(program);

  [
    [...results].slice(0, 8),
    '...',
    [...results].slice(-8)
  ];

}