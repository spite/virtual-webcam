(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  vw.addFilter({
    id: "pixelate",
    name: "Pixelate",
    source: `
// Number of blocks across the height of the image.
const float BLOCKS = 48.0;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float size = iResolution.y / BLOCKS;
  vec2 center = (floor(fragCoord / size) + 0.5) * size;
  fragColor = texture(iChannel0, center / iResolution.xy);
}
`,
  });
})();
