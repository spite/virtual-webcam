(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  vw.addFilter({
    id: "black-and-white",
    name: "Black & white",
    source: `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec3 color = texture(iChannel0, fragCoord / iResolution.xy).rgb;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  fragColor = vec4(vec3(smoothstep(0.03, 0.97, luma)), 1.0);
}
`,
  });
})();
