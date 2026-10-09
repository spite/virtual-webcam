(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  vw.addFilter({
    id: "thermal",
    name: "Thermal camera",
    source: `
vec3 heat(float t) {
  const vec3 c0 = vec3(0.0, 0.0, 0.05);
  const vec3 c1 = vec3(0.15, 0.0, 0.55);
  const vec3 c2 = vec3(0.65, 0.0, 0.6);
  const vec3 c3 = vec3(1.0, 0.25, 0.0);
  const vec3 c4 = vec3(1.0, 0.8, 0.0);
  const vec3 c5 = vec3(1.0, 1.0, 0.9);
  t = clamp(t, 0.0, 1.0) * 5.0;
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  if (t < 4.0) return mix(c3, c4, t - 3.0);
  return mix(c4, c5, t - 4.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 px = 3.0 / iResolution.xy;
  vec3 c = texture(iChannel0, uv).rgb * 0.4
         + texture(iChannel0, uv + vec2(px.x, 0.0)).rgb * 0.15
         + texture(iChannel0, uv - vec2(px.x, 0.0)).rgb * 0.15
         + texture(iChannel0, uv + vec2(0.0, px.y)).rgb * 0.15
         + texture(iChannel0, uv - vec2(0.0, px.y)).rgb * 0.15;
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  fragColor = vec4(heat(smoothstep(0.05, 0.95, luma)), 1.0);
}
`,
  });
})();
