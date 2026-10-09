(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  vw.addFilter({
    id: "posterize",
    name: "Posterize",
    source: `
// Colour steps per channel.
const float LEVELS = 4.0;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec3 c = texture(iChannel0, fragCoord / iResolution.xy).rgb;
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = clamp(mix(vec3(luma), c, 1.4), 0.0, 1.0);
  c = floor(c * (LEVELS - 1.0) + 0.5) / (LEVELS - 1.0);
  fragColor = vec4(c, 1.0);
}
`,
  });
})();
