function inject(source) {
  const script = document.createElement("script");
  script.textContent = source;
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
  script.onload = function () {
    script.parentNode.removeChild(script);
  };
}

// webcam icon by Paomedia https://www.iconfinder.com/icons/299109/webcam_icon

function source() {
  console.log("HAI");

  class ShaderRenderer {
    constructor(canvas, video) {
      this.canvas = canvas;
      this.video = video;

      this.gl = this.canvas.getContext("webgl");
      //this.gl.getExtension('EXT_shader_texture_lod');

      this.program = this.createProgram(vs, wrapShaderToy(distortedTV));

      this.texture = this.gl.createTexture();

      this.positionAttributeLocation = this.gl.getAttribLocation(this.program, "a_position");
      this.positionBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,  // first triangle
        1, -1,
        -1, 1,
        -1, 1,  // second triangle
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

  const distortedTV = `
// change these values to 0.0 to turn off individual effects
float vertJerkOpt = 1.0;
float vertMovementOpt = 1.0;
float bottomStaticOpt = 1.0;
float scalinesOpt = 1.0;
float rgbOffsetOpt = 1.0;
float horzFuzzOpt = 1.0;

// Noise generation functions borrowed from: 
// https://github.com/ashima/webgl-noise/blob/master/src/noise2D.glsl

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec2 mod289(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 permute(vec3 x) {
  return mod289(((x*34.0)+1.0)*x);
}

float snoise(vec2 v)
  {
  const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                      0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                     -0.577350269189626,  // -1.0 + 2.0 * C.x
                      0.024390243902439); // 1.0 / 41.0
// First corner
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);

// Other corners
  vec2 i1;
  //i1.x = step( x0.y, x0.x ); // x0.x > x0.y ? 1.0 : 0.0
  //i1.y = 1.0 - i1.x;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  // x0 = x0 - 0.0 + 0.0 * C.xx ;
  // x1 = x0 - i1 + 1.0 * C.xx ;
  // x2 = x0 - 1.0 + 2.0 * C.xx ;
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;

// Permutations
  i = mod289(i); // Avoid truncation effects in permutation
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
		+ i.x + vec3(0.0, i1.x, 1.0 ));

  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;

// Gradients: 41 points uniformly over a line, mapped onto a diamond.
// The ring size 17*17 = 289 is close to a multiple of 41 (41*7 = 287)

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;

// Normalise gradients implicitly by scaling m
// Approximation of: m *= inversesqrt( a0*a0 + h*h );
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );

// Compute final noise value at P
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float staticV(vec2 uv) {
    float staticHeight = snoise(vec2(9.0,iTime*1.2+3.0))*0.3+5.0;
    float staticAmount = snoise(vec2(1.0,iTime*1.2-6.0))*0.1+0.3;
    float staticStrength = snoise(vec2(-9.75,iTime*0.6-3.0))*2.0+2.0;
	return (1.0-step(snoise(vec2(5.0*pow(iTime,2.0)+pow(uv.x*7.0,1.2),pow((mod(iTime,100.0)+100.0)*uv.y*0.3+3.0,staticHeight))),staticAmount))*staticStrength;
}


void mainImage( out vec4 fragColor, in vec2 fragCoord )
{

	vec2 uv =  fragCoord.xy/iResolution.xy;
	
	float jerkOffset = (1.0-step(snoise(vec2(iTime*1.3,5.0)),0.8))*0.05;
	
	float fuzzOffset = snoise(vec2(iTime*15.0,uv.y*80.0))*0.003;
	float largeFuzzOffset = snoise(vec2(iTime*1.0,uv.y*25.0))*0.004;
    
    float vertMovementOn = (1.0-step(snoise(vec2(iTime*0.2,8.0)),0.4))*vertMovementOpt;
    float vertJerk = (1.0-step(snoise(vec2(iTime*1.5,5.0)),0.6))*vertJerkOpt;
    float vertJerk2 = (1.0-step(snoise(vec2(iTime*5.5,5.0)),0.2))*vertJerkOpt;
    float yOffset = abs(sin(iTime)*4.0)*vertMovementOn+vertJerk*vertJerk2*0.3;
    float y = mod(uv.y+yOffset,1.0);
    
	
	float xOffset = (fuzzOffset + largeFuzzOffset) * horzFuzzOpt;
    
    float staticVal = 0.0;
   
    for (float y = -1.0; y <= 1.0; y += 1.0) {
        float maxDist = 5.0/200.0;
        float dist = y/200.0;
    	staticVal += staticV(vec2(uv.x,uv.y+dist))*(maxDist-abs(dist))*1.5;
    }
        
    staticVal *= bottomStaticOpt;
	
	float red 	=   texture2D(	iChannel0, 	vec2(uv.x + xOffset -0.01*rgbOffsetOpt,y)).r+staticVal;
	float green = 	texture2D(	iChannel0, 	vec2(uv.x + xOffset,	  y)).g+staticVal;
	float blue 	=	texture2D(	iChannel0, 	vec2(uv.x + xOffset +0.01*rgbOffsetOpt,y)).b+staticVal;
	
	vec3 color = vec3(red,green,blue);
	float scanline = sin(uv.y*800.0)*0.04*scalinesOpt;
	color -= scanline;
	
	fragColor = vec4(color,1.0);
}
`;

  const moneyFilter = `
    void mainImage( out vec4 fragColor, in vec2 fragCoord )
  {
      vec2 xy = fragCoord.xy / iResolution.yy;
      
      float amplitud = 0.03;
      float frecuencia = 10.0;
      float gris = 1.0;
      float divisor = 4.8 / iResolution.y;
      float grosorInicial = divisor * 0.2;
      
      const int kNumPatrones = 6;
      
    vec3 datosPatron[kNumPatrones];
      datosPatron[0] = vec3(-0.7071, 0.7071, 3.0); // -45
      datosPatron[1] = vec3(0.0, 1.0, 0.6); // 0
      datosPatron[2] = vec3(0.0, 1.0, 0.5); // 0
      datosPatron[3] = vec3(1.0, 0.0, 0.4); // 90
      datosPatron[4] = vec3(1.0, 0.0, 0.3); // 90
      datosPatron[5] = vec3(0.0, 1.0, 0.2); // 0
  
      vec4 color = texture2D(iChannel0, vec2(fragCoord.x / iResolution.x, xy.y));
      fragColor = color;
      
      for(int i = 0; i < kNumPatrones; i++)
      {
          float coseno = datosPatron[i].x;
          float seno = datosPatron[i].y;
          
          vec2 punto = vec2(
              xy.x * coseno - xy.y * seno,
              xy.x * seno + xy.y * coseno
          );
  
          float grosor = grosorInicial * float(i + 1);
          float dist = mod(punto.y + grosor * 0.5 - sin(punto.x * frecuencia) * amplitud, divisor);
          float brillo = 0.3 * color.r + 0.4 * color.g + 0.3 * color.b;
  
          if(dist < grosor && brillo < 0.75 - 0.12 * float(i))
          {
              // Suavizado
              float k = datosPatron[i].z;
              float x = (grosor - dist) / grosor;
              float fx = abs((x - 0.5) / k) - (0.5 - k) / k; 
              gris = min(fx, gris);
          }
      }
      
      fragColor = vec4(gris, gris, gris, 1.0);
  }
 `;

  const oldFilm = `
  #define SEQUENCE_LENGTH 24.0
  #define FPS 12.
  
  vec4 vignette(vec2 uv, float time) 
  {
      uv *=  1.0 - uv.yx;   
      float vig = uv.x*uv.y * 15.0;
      float t = sin(time * 23.) * cos(time * 8. + .5);
      vig = pow(vig, 0.4 + t * .05);
      return vec4(vig);
  }
  
  float easeIn(float t0, float t1, float t) 
  {
    return 2.0*smoothstep(t0,2.*t1-t0,t);
  }
  
  vec4 blackAndWhite(vec4 color) 
  {
      return vec4(dot(color.xyz, vec3(.299, .587, .114)));
  }
  
  float filmDirt(vec2 pp, float time) 
  {
    float aaRad = 0.1;
    vec2 nseLookup2 = pp + vec2(.5,.9) + time*100.;
    vec3 nse2 =
      vec3(0.);
    float thresh = .6;
    float mul1 = smoothstep(thresh-aaRad,thresh+aaRad,nse2.x);
    float mul2 = smoothstep(thresh-aaRad,thresh+aaRad,nse2.y);
    float mul3 = smoothstep(thresh-aaRad,thresh+aaRad,nse2.z);
    
    float seed = texture2D(iChannel0,vec2(time*.35,time),0.).x;
    
    float result = clamp(0.,1.,seed+.7) + .3*smoothstep(0.,SEQUENCE_LENGTH,time);
    
    result += .06*easeIn(19.2,19.4,time);
  
    float band = .05;
    if( 0.3 < seed && .3+band > seed )
      return mul1 * result;
    if( 0.6 < seed && .6+band > seed )
      return mul2 * result;
    if( 0.9 < seed && .9+band > seed )
      return mul3 * result;
    return result;
  }
  
  vec4 jumpCut(float seqTime) 
  {
    float toffset = 0.;
    vec3 camoffset = vec3(0.);
    
    float jct = seqTime;
    float jct1 = 7.7;
    float jct2 = 8.2;
    float jc1 = step( jct1, jct );
    float jc2 = step( jct2, jct );
    
    camoffset += vec3(.8,.0,.0) * jc1;
    camoffset += vec3(-.8,0.,.0) * jc2;
    
    toffset += 0.8 * jc1;
    toffset -= (jc2-jc1)*(jct-jct1);
    toffset -= 0.9 * jc2;
    
    return vec4(camoffset, toffset);
  }
  
  float limitFPS(float time, float fps) 
  {
      time = mod(time, SEQUENCE_LENGTH);
      return float(int(time * fps)) / fps;
  }
  
  vec2 moveImage(vec2 uv, float time) 
  {
      uv.x += .002 * (cos(time * 3.) * sin(time * 12. + .25));
      uv.y += .002 * (sin(time * 1. + .5) * cos(time * 15. + .25));
      return uv;
  }
  
  void mainImage(out vec4 fragColor, in vec2 fragCoord) 
  {
      vec2 uv = fragCoord.xy / iResolution.xy;
      vec2 qq = -1.0 + 2.0*uv;
      qq.x *= iResolution.x / iResolution.y;
      
    float time = limitFPS(iTime, FPS);
  
    vec4 jumpCutData = jumpCut(time);
      vec4 dirt = vec4(filmDirt(qq, time + jumpCutData.w));     
      vec4 image = texture2D(iChannel0, moveImage(uv, time));   
      vec4 vig = vignette(uv, time);
      
      fragColor = image * dirt * vig;
      fragColor = blackAndWhite(fragColor);
  }`;

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

  class FilterStream {
    constructor(stream) {
      console.log("New Filter for stream", stream);
      this.stream = stream;
      const video = document.createElement("video");
      const canvas = document.createElement("canvas");
      this.canvas = canvas;
      this.renderer = new ShaderRenderer(this.canvas, video);

      video.addEventListener("playing", () => {
        // this.canvas.width = this.video.videoWidth;
        // this.canvas.height = this.video.videoHeight;
        this.renderer.setSize(this.video.videoWidth, this.video.videoHeight);
        this.update();
      });
      video.srcObject = stream;
      video.autoplay = true;
      this.video = video;
      //this.ctx = this.canvas.getContext('2d');
      this.outputStream = this.canvas.captureStream();
    }

    update() {
      // this.ctx.filter = 'invert(1)';
      // this.ctx.drawImage(this.video, 0, 0);
      // this.ctx.fillStyle = '#ff00ff';
      // this.ctx.textBaseline = 'top';
      // this.ctx.fillText('Virtual', 10, 10)
      this.renderer.render();
      requestAnimationFrame(() => this.update());
    }
  }

  const enumerateDevicesFn = MediaDevices.prototype.enumerateDevices;
  const getUserMediaFn = MediaDevices.prototype.getUserMedia;

  MediaDevices.prototype.enumerateDevices = async function () {
    const res = await enumerateDevicesFn.call(navigator.mediaDevices);
    res.push({
      deviceId: "virtual",
      groupID: "uh",
      kind: "videoinput",
      label: "Virtual Chrome Webcam",
    });
    return res;
  };

  MediaDevices.prototype.getUserMedia = async function () {
    const args = arguments;
    console.log(args[0]);
    if (args.length && args[0].video && args[0].video.deviceId) {
      if (
        args[0].video.deviceId === "virtual" ||
        args[0].video.deviceId.exact === "virtual"
      ) {
        const constraints = {
          video: {
            facingMode: args[0].facingMode,
            advanced: args[0].video.advanced,
            width: args[0].video.width,
            height: args[0].video.height,
          },
          audio: false,
        };
        const res = await getUserMediaFn.call(
          navigator.mediaDevices,
          constraints
        );
        if (res) {
          const filter = new FilterStream(res);
          return filter.outputStream;
        }
      }
    }
    const res = await getUserMediaFn.call(navigator.mediaDevices, ...arguments);
    return res;
  };
}

inject(`${source};source();`);
