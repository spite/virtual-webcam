(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  vw.addFilter({
    id: "sepia",
    name: "Sepia",
    source: `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 c = texture(iChannel0, uv).rgb;
  vec3 sepia = vec3(
    dot(c, vec3(0.393, 0.769, 0.189)),
    dot(c, vec3(0.349, 0.686, 0.168)),
    dot(c, vec3(0.272, 0.534, 0.131)));
  float vignette = smoothstep(0.85, 0.3, length(uv - 0.5));
  fragColor = vec4(min(sepia, 1.0) * mix(0.6, 1.0, vignette), 1.0);
}
`,
  });
})();
