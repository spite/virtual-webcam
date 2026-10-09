(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  const VIDEO_SOURCES = ["camera", "display", "tab-video", "file", "relay"];
  const BACKGROUNDS = ["keep", "blur", "image", "display", "tab-video", "file", "relay"];
  let state = {
    virtualDefault: false,
    filterId: vw.DEFAULT_FILTER_ID,
    customSource: null,
    customLanguage: "glsl",
    overrides: {},
    videoSource: "camera",
    flip: { x: false, y: false },
    background: "keep",
    backgroundImage: null,
  };
  const listeners = new Set();
  let resolveReady;
  // Falls back to the defaults if the settings bridge never answers.
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
    setTimeout(resolve, 1000);
  });

  document.addEventListener("virtual-webcam:settings", (e) => {
    let next;
    try {
      next = JSON.parse(e.detail);
    } catch {
      return;
    }
    if (!next || typeof next !== "object") return;
    state = {
      virtualDefault: next.virtualDefault === true,
      filterId: String(next.filterId),
      customSource: typeof next.customSource === "string" ? next.customSource : null,
      customLanguage: next.customLanguage === "js" ? "js" : "glsl",
      overrides: next.overrides && typeof next.overrides === "object" ? next.overrides : {},
      videoSource: VIDEO_SOURCES.includes(next.source) ? next.source : "camera",
      flip: { x: next.flip?.x === true, y: next.flip?.y === true },
      background: BACKGROUNDS.includes(next.background) ? next.background : "keep",
      backgroundImage: next.backgroundImage == null ? null : String(next.backgroundImage),
    };
    resolveReady();
    listeners.forEach((listener) => listener());
  });
  document.dispatchEvent(new CustomEvent("virtual-webcam:request-settings"));

  vw.extensionSettings = {
    ready,
    current: () => {
      const filter = vw.findFilter(state.filterId);
      const override = state.overrides[filter.id];
      return {
        virtualDefault: state.virtualDefault,
        filter: state.customSource !== null
          ? { language: state.customLanguage, source: state.customSource }
          : { language: filter.language, source: typeof override === "string" ? override : filter.source },
        videoSource: state.videoSource,
        flip: state.flip,
        background: state.background,
        backgroundImage: state.backgroundImage,
      };
    },
    onChange: (listener) => listeners.add(listener),
  };
})();
