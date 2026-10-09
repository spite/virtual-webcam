(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  vw.addFilter({
    id: "kaleidoscope",
    name: "Kaleidoscope",
    source: `
// Number of mirrored slices.
const float SEGMENTS = 8.0;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  float radius = length(p);
  float angle = atan(p.y, p.x) + iTime * 0.1;
  float slice = 6.28318 / SEGMENTS;
  angle = abs(mod(angle, slice) - slice * 0.5);

  vec2 q = radius * vec2(cos(angle), sin(angle));
  vec2 uv = vec2(q.x * iResolution.y / iResolution.x, q.y) + 0.5;
  uv = 1.0 - abs(1.0 - mod(uv, 2.0));
  fragColor = texture(iChannel0, uv);
}
`,
  });
})();
