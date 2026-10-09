(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  vw.addFilter({
    id: "pencil-sketch",
    name: "Pencil sketch",
    source: `
float luma(vec2 uv) {
  return dot(texture(iChannel0, uv).rgb, vec3(0.299, 0.587, 0.114));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 px = 1.5 / iResolution.xy;

  float tl = luma(uv + px * vec2(-1.0, 1.0));
  float t = luma(uv + px * vec2(0.0, 1.0));
  float tr = luma(uv + px * vec2(1.0, 1.0));
  float l = luma(uv + px * vec2(-1.0, 0.0));
  float r = luma(uv + px * vec2(1.0, 0.0));
  float bl = luma(uv + px * vec2(-1.0, -1.0));
  float b = luma(uv + px * vec2(0.0, -1.0));
  float br = luma(uv + px * vec2(1.0, -1.0));
  float gx = tr + 2.0 * r + br - tl - 2.0 * l - bl;
  float gy = tl + 2.0 * t + tr - bl - 2.0 * b - br;
  float outline = 1.0 - smoothstep(0.08, 0.45, length(vec2(gx, gy)));

  float shade = luma(uv);
  float hatch = 1.0;
  if (shade < 0.45) hatch -= 0.35 * (1.0 - step(1.0, mod(fragCoord.x + fragCoord.y, 6.0)));
  if (shade < 0.25) hatch -= 0.35 * (1.0 - step(1.0, mod(fragCoord.x - fragCoord.y, 6.0)));

  vec3 paper = vec3(0.97, 0.96, 0.92);
  fragColor = vec4(paper * min(outline, hatch) * mix(0.85, 1.0, shade), 1.0);
}
`,
  });
})();
