(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  vw.addFilter({
    id: "game-boy",
    name: "Game Boy",
    source: `
// Vertical resolution of the original Game Boy screen.
const float HEIGHT = 144.0;

const vec3 PALETTE[4] = vec3[4](
  vec3(0.059, 0.220, 0.059),
  vec3(0.188, 0.384, 0.188),
  vec3(0.545, 0.675, 0.059),
  vec3(0.608, 0.737, 0.059));

const float BAYER[16] = float[16](
  0.0, 8.0, 2.0, 10.0,
  12.0, 4.0, 14.0, 6.0,
  3.0, 11.0, 1.0, 9.0,
  15.0, 7.0, 13.0, 5.0);

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float size = iResolution.y / HEIGHT;
  vec2 cell = floor(fragCoord / size);
  vec3 c = texture(iChannel0, (cell + 0.5) * size / iResolution.xy).rgb;
  float luma = smoothstep(0.05, 0.9, dot(c, vec3(0.299, 0.587, 0.114)));

  ivec2 p = ivec2(mod(cell, 4.0));
  float dither = BAYER[p.y * 4 + p.x] / 16.0;
  int level = int(clamp(floor(luma * 3.0 + dither), 0.0, 3.0));
  fragColor = vec4(PALETTE[level], 1.0);
}
`,
  });
})();
