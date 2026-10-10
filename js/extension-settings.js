(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  const BACKGROUNDS = ["room", "blur", "image", "display", "tab-video", "file", "relay"];
  let state = {
    virtualDefault: false,
    scene: { camera: true, flip: { x: false, y: false }, background: "room" },
    effects: [],
    backgroundImage: null,
  };
  const listeners = new Set();
  let resolveReady;
  // Falls back to the defaults if the settings bridge never answers.
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
    setTimeout(resolve, 1000);
  });

  function readEffect(effect) {
    if (!effect || typeof effect !== "object") return null;
    if (effect.builtin) {
      const filter = vw.filters.find((candidate) => candidate.id === effect.id);
      if (!filter) return null;
      return { language: filter.language, source: typeof effect.source === "string" ? effect.source : filter.source };
    }
    if (typeof effect.source !== "string") return null;
    return { language: effect.language === "js" ? "js" : "glsl", source: effect.source };
  }

  document.addEventListener("virtual-webcam:settings", (e) => {
    let next;
    try {
      next = JSON.parse(e.detail);
    } catch {
      return;
    }
    if (!next || typeof next !== "object" || !next.scene) return;
    state = {
      virtualDefault: next.virtualDefault === true,
      scene: {
        camera: next.scene.camera !== false,
        flip: { x: next.scene.flip?.x === true, y: next.scene.flip?.y === true },
        background: BACKGROUNDS.includes(next.scene.background) ? next.scene.background : "room",
      },
      effects: (Array.isArray(next.effects) ? next.effects : []).map(readEffect).filter(Boolean),
      backgroundImage: next.backgroundImage == null ? null : String(next.backgroundImage),
    };
    resolveReady();
    listeners.forEach((listener) => listener());
  });
  document.dispatchEvent(new CustomEvent("virtual-webcam:request-settings"));

  vw.extensionSettings = {
    ready,
    current: () => ({
      virtualDefault: state.virtualDefault,
      ...state.scene,
      effects: state.effects,
      backgroundImage: state.backgroundImage,
    }),
    onChange: (listener) => listeners.add(listener),
  };
})();
