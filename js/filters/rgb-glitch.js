(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  vw.addFilter({
    id: "rgb-glitch",
    name: "RGB glitch",
    source: `
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float step12 = floor(iTime * 12.0);
  float burst = step(0.6, hash(vec2(floor(iTime * 2.0), 3.0)));

  float band = floor(uv.y * 24.0);
  float jump = step(0.7, hash(vec2(step12, band * 1.7)));
  float offset = (hash(vec2(band, step12)) - 0.5) * 0.12 * jump * burst;
  float split = 0.003 + 0.02 * burst * hash(vec2(step12, 9.0));

  vec2 shifted = vec2(uv.x + offset, uv.y);
  vec3 c = vec3(
    texture(iChannel0, shifted + vec2(split, 0.0)).r,
    texture(iChannel0, shifted).g,
    texture(iChannel0, shifted - vec2(split, 0.0)).b);

  float block = step(0.97, hash(floor(uv * vec2(8.0, 16.0)) + step12)) * burst;
  c = mix(c, 1.0 - c, block);
  c += (hash(fragCoord + step12) - 0.5) * 0.06;
  fragColor = vec4(c, 1.0);
}
`,
  });
})();
