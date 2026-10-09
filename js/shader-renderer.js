(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  const vs = `#version 300 es
in vec4 a_position;

void main() {
  gl_Position = a_position;
}
`;

  vw.PASSTHROUGH_SHADER = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = texture(iChannel0, fragCoord / iResolution.xy);
}
`;

  function wrapShaderToy(source) {
    return `#version 300 es
precision highp float;
precision highp int;

uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrameRate;
uniform int iFrame;
uniform float iChannelTime[4];
uniform vec3 iChannelResolution[4];
uniform vec4 iMouse;
uniform vec4 iDate;
uniform float iSampleRate;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;

out vec4 virtualWebcamFragColor;

#define texture2D texture
#line 1
${source}

void main() {
  vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(color, gl_FragCoord.xy);
  virtualWebcamFragColor = vec4(color.rgb, 1.0);
}
`;
  }

  const flipFs = `#version 300 es
precision highp float;
uniform sampler2D source;
uniform vec2 flip;
uniform vec2 size;
out vec4 color;

void main() {
  vec2 uv = gl_FragCoord.xy / size;
  color = texture(source, mix(uv, 1.0 - uv, flip));
}
`;

  // Keeps iTime small enough for float32 shader math to stay precise.
  const TIME_WRAP = 1000;

  class ShaderError extends Error {
    constructor(log) {
      super("Could not compile the filter shader.\n\n" + log);
      this.name = "ShaderError";
      this.log = log;
      this.errors = log.split("\n")
        .map((line) => line.match(/^ERROR:\s*\d+:(\d+|\?):\s*(.*)$/))
        .filter(Boolean)
        .map(([, line, message]) => ({ line: line === "?" ? null : Number(line), message }));
    }
  }

  class ShaderRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.startTime = performance.now();
      this.lastTime = 0;
      this.frame = 0;
      this.source = null;
      this.program = null;
      this.flip = { x: false, y: false };

      this.gl = canvas.getContext("webgl2", { alpha: false });
      if (!this.gl) {
        throw new Error("WebGL2 is not available.");
      }

      canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
      canvas.addEventListener("webglcontextrestored", () => this.restore());
      this.initResources();
    }

    initResources() {
      const gl = this.gl;
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        -1, 1,
        1, -1,
        1, 1,
      ]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.flipPass = null;
    }

    setFlip(x, y) {
      this.flip = { x: Boolean(x), y: Boolean(y) };
    }

    // Copies the source texture flipped into an offscreen texture, which the filter then samples.
    flipSource(width, height, flipX, flipY) {
      const gl = this.gl;
      if (!this.flipPass) {
        const program = this.createProgram(vs, flipFs);
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.flipPass = {
          program,
          texture,
          framebuffer: gl.createFramebuffer(),
          width: 0,
          height: 0,
          source: gl.getUniformLocation(program, "source"),
          flip: gl.getUniformLocation(program, "flip"),
          size: gl.getUniformLocation(program, "size"),
        };
      }
      const pass = this.flipPass;
      gl.bindTexture(gl.TEXTURE_2D, pass.texture);
      if (pass.width !== width || pass.height !== height) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, pass.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pass.texture, 0);
        pass.width = width;
        pass.height = height;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, pass.framebuffer);
      gl.useProgram(pass.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(pass.source, 0);
      gl.uniform2f(pass.flip, flipX ? 1 : 0, flipY ? 1 : 0);
      gl.uniform2f(pass.size, width, height);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, pass.texture);
    }

    restore() {
      const source = this.source;
      this.program = null;
      this.initResources();
      if (source !== null) {
        try {
          this.setShader(source);
        } catch (e) {
          console.error("Virtual webcam: could not restore the filter.", e);
        }
      }
    }

    // Throws a ShaderError and keeps the current shader if the new one doesn't compile.
    setShader(source) {
      const gl = this.gl;
      const program = this.createProgram(vs, wrapShaderToy(source));
      if (this.program) gl.deleteProgram(this.program);
      this.program = program;
      this.source = source;
      this.frame = 0;

      const uniforms = {};
      const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < count; i++) {
        const name = gl.getActiveUniform(program, i).name.replace(/\[0\]$/, "");
        uniforms[name] = gl.getUniformLocation(program, name);
      }
      this.uniforms = uniforms;

      gl.useProgram(program);
      for (let unit = 0; unit < 4; unit++) {
        const location = uniforms[`iChannel${unit}`];
        if (location) gl.uniform1i(location, unit);
      }
      if (uniforms.iSampleRate) gl.uniform1f(uniforms.iSampleRate, 44100);
    }

    createShader(sourceCode, type) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, sourceCode);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new ShaderError(info);
      }
      return shader;
    }

    createProgram(vertexShaderSource, fragmentShaderSource) {
      const gl = this.gl;
      const vertexShader = this.createShader(vertexShaderSource, gl.VERTEX_SHADER);
      let fragmentShader;
      try {
        fragmentShader = this.createShader(fragmentShaderSource, gl.FRAGMENT_SHADER);
      } catch (e) {
        gl.deleteShader(vertexShader);
        throw e;
      }

      const program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.bindAttribLocation(program, 0, "a_position");
      gl.linkProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new ShaderError(info);
      }
      return program;
    }

    setSize(w, h) {
      if (this.canvas.width === w && this.canvas.height === h) return;
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }

    // Returns false when nothing was drawn.
    render(source) {
      const gl = this.gl;
      if (!this.program || gl.isContextLost()) return false;

      const time = ((performance.now() - this.startTime) / 1000) % TIME_WRAP;
      const delta = this.frame ? Math.max(0, time - this.lastTime) : 0;
      this.lastTime = time;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

      const { width, height } = this.canvas;
      // WebGL ignores UNPACK_FLIP_Y_WEBGL for ImageBitmaps, so they arrive upside down.
      const flipY = this.flip.y !== (source instanceof ImageBitmap);
      if (this.flip.x || flipY) this.flipSource(width, height, this.flip.x, flipY);
      const u = this.uniforms;
      const date = new Date();
      gl.useProgram(this.program);
      gl.uniform3f(u.iResolution, width, height, 1);
      gl.uniform1f(u.iTime, time);
      gl.uniform1f(u.iTimeDelta, delta);
      gl.uniform1f(u.iFrameRate, delta ? 1 / delta : 0);
      gl.uniform1i(u.iFrame, this.frame);
      gl.uniform1fv(u.iChannelTime, [time, 0, 0, 0]);
      gl.uniform3fv(u.iChannelResolution, [width, height, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      gl.uniform4f(u.iDate, date.getFullYear(), date.getMonth(), date.getDate(),
        date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000);

      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      this.frame++;
      return true;
    }
  }

  vw.ShaderError = ShaderError;
  vw.ShaderRenderer = ShaderRenderer;
})();
