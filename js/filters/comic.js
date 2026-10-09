(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  vw.addFilter({
    id: "comic",
    name: "Comic halftone",
    source: `
// Halftone dot spacing in pixels.
const float CELL = 7.0;

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

float edge(vec2 uv) {
  vec2 px = 1.5 / iResolution.xy;
  float l = luma(texture(iChannel0, uv - vec2(px.x, 0.0)).rgb);
  float r = luma(texture(iChannel0, uv + vec2(px.x, 0.0)).rgb);
  float t = luma(texture(iChannel0, uv + vec2(0.0, px.y)).rgb);
  float b = luma(texture(iChannel0, uv - vec2(0.0, px.y)).rgb);
  return length(vec2(r - l, t - b));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 c = texture(iChannel0, uv).rgb;
  vec3 tone = clamp(mix(vec3(luma(c)), c, 1.5), 0.0, 1.0);
  tone = floor(tone * 3.0 + 0.5) / 3.0;

  mat2 rotation = mat2(0.7071, -0.7071, 0.7071, 0.7071);
  vec2 p = rotation * fragCoord;
  vec2 cell = (floor(p / CELL) + 0.5) * CELL;
  vec2 center = transpose(rotation) * cell;
  float darkness = 1.0 - luma(texture(iChannel0, center / iResolution.xy).rgb);
  float radius = CELL * 0.6 * sqrt(max(darkness - 0.25, 0.0) / 0.75);
  float dots = smoothstep(radius + 0.75, radius - 0.75, length(p - cell));

  vec3 color = mix(tone, tone * 0.45, dots);
  color = mix(color, vec3(0.05), smoothstep(0.12, 0.3, edge(uv)));
  fragColor = vec4(color, 1.0);
}
`,
  });
})();
