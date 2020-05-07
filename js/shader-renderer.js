const vs = `
  attribute vec4 a_position;

  void main() {
    gl_Position = a_position;
  }
`;

const fs = `
precision highp float;

uniform vec2 iResolution;
uniform sampler2D iChannel0;
uniform float iTime;

  void main() {
    vec2 uv = gl_FragCoord.xy / iResolution;
    vec4 cam = texture2D(iChannel0, uv);
    gl_FragColor = vec4(cam.r, uv, 1.);
  }
`;

function wrapShaderToy(source) {
  return `

precision highp float;

uniform vec2 iResolution;
uniform sampler2D iChannel0;
uniform float iTime;

${source}

void main() {
  vec4 col;
  mainImage(col, gl_FragCoord.xy);
  gl_FragColor = col;
}
`;
}

class ShaderRenderer {
  constructor(canvas, video, shader) {
    this.canvas = canvas;
    this.video = video;

    this.gl = this.canvas.getContext("webgl");
    //this.gl.getExtension('EXT_shader_texture_lod');

    this.program = this.createProgram(vs, wrapShaderToy(shader));

    this.texture = this.gl.createTexture();

    this.positionAttributeLocation = this.gl.getAttribLocation(this.program, "a_position");
    this.positionBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ]), this.gl.STATIC_DRAW);
    this.resolutionLocation = this.gl.getUniformLocation(this.program, "iResolution");
    this.cameraLocation = this.gl.getUniformLocation(this.program, 'iChannel0');
    this.timeLocation = this.gl.getUniformLocation(this.program, "iTime");
  }

  createShader(sourceCode, type) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, sourceCode);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      var info = this.gl.getShaderInfoLog(shader);
      console.log(info);
      debugger;
      throw 'Could not compile WebGL program. \n\n' + info;
    }
    return shader;
  }

  createProgram(vertexShaderSource, fragmentShaderSource) {
    const vertexShader = this.createShader(vertexShaderSource, this.gl.VERTEX_SHADER);
    const fragmentShader = this.createShader(fragmentShaderSource, this.gl.FRAGMENT_SHADER);

    var program = this.gl.createProgram();
    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);
    var success = this.gl.getProgramParameter(program, this.gl.LINK_STATUS);
    if (success) {
      return program;
    }
    console.log(this.gl.getProgramInfoLog(program));
    this.gl.deleteProgram(program);
  }

  setSize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  render() {
    //this.gl.clearColor(255, 0, 255, 1);
    //this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.video);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);

    this.gl.useProgram(this.program);
    this.gl.uniform2f(this.resolutionLocation, this.gl.canvas.width, this.gl.canvas.height);
    if (this.timeLocation) {
      this.gl.uniform1f(this.timeLocation, .001 * performance.now());
    }

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.uniform1i(this.cameraLocation, 0);

    this.gl.enableVertexAttribArray(this.positionAttributeLocation);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
    this.gl.vertexAttribPointer(this.positionAttributeLocation, 2, this.gl.FLOAT, false, 0, 0);

    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }
}

export { ShaderRenderer }