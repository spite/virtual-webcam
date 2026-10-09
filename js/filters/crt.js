(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  vw.addFilter({
    id: "crt",
    name: "CRT monitor",
    source: `
vec2 curve(vec2 uv) {
  uv = uv * 2.0 - 1.0;
  vec2 offset = abs(uv.yx) / vec2(6.0, 4.0);
  uv += uv * offset * offset;
  return uv * 0.5 + 0.5;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = curve(fragCoord / iResolution.xy);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float shift = 1.5 / iResolution.x;
  vec3 c = vec3(
    texture(iChannel0, uv + vec2(shift, 0.0)).r,
    texture(iChannel0, uv).g,
    texture(iChannel0, uv - vec2(shift, 0.0)).b);

  float scanline = 0.82 + 0.18 * sin(uv.y * iResolution.y * 3.14159);
  float column = mod(floor(fragCoord.x), 3.0);
  vec3 mask = column < 1.0 ? vec3(1.0, 0.85, 0.85)
            : column < 2.0 ? vec3(0.85, 1.0, 0.85)
            : vec3(0.85, 0.85, 1.0);
  float vignette = pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.15);
  float flicker = 0.97 + 0.03 * sin(iTime * 110.0);

  fragColor = vec4(c * scanline * mask * vignette * flicker * 1.45, 1.0);
}
`,
  });
})();
