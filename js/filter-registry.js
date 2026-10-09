(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  vw.filters ??= [];
  vw.DEFAULT_FILTER_ID = "distorted-tv";
  vw.SETTINGS_DEFAULTS = {
    virtualDefault: false,
    activeFilterId: vw.DEFAULT_FILTER_ID,
    customFilters: [],
    builtinOverrides: {},
    source: "camera",
    videoFile: null,
    flipHorizontal: false,
    flipVertical: false,
    background: "keep",
    backgroundImage: null,
  };

  // language is "glsl" (a Shadertoy-style shader) or "js" (a JavaScript filter run in the sandbox).
  vw.addFilter = (filter) => vw.filters.push({
    language: "glsl",
    ...filter,
    source: filter.source.replace(/^\n/, ""),
  });
  vw.findFilter = (id) =>
    vw.filters.find((filter) => filter.id === id) ??
    vw.filters.find((filter) => filter.id === vw.DEFAULT_FILTER_ID);
})();
