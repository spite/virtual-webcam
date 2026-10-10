// Scenes: what the virtual camera shows, as layers (you, a background, and an ordered list of effects).
(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  const BACKGROUNDS = ["room", "blur", "image", "display", "tab-video", "file", "relay"];
  const SOURCE_BACKGROUNDS = ["display", "tab-video", "file", "relay"];
  // Backgrounds that can be shown on their own, with the camera off.
  const STANDALONE_BACKGROUNDS = ["image", ...SOURCE_BACKGROUNDS];

  const OVER = {
    blur: "Camera, blurred background",
    image: "You over an image",
    display: "You over a tab or window",
    "tab-video": "You over a video in a tab",
    file: "You over the video file",
    relay: "You over the shared video",
  };
  const ALONE = {
    image: "Image",
    display: "Tab, window or screen",
    "tab-video": "Video in a tab",
    file: "Video file",
    relay: "Shared video",
  };

  function createScene(fields = {}) {
    return normalizeScene({
      id: `scene-${crypto.randomUUID()}`,
      name: "New scene",
      camera: true,
      flip: { x: false, y: false },
      background: "room",
      effects: [],
      ...fields,
    });
  }

  function normalizeScene(scene) {
    const background = BACKGROUNDS.includes(scene?.background) ? scene.background : "room";
    return {
      id: String(scene?.id ?? `scene-${crypto.randomUUID()}`),
      name: String(scene?.name || "Untitled scene"),
      // With the camera off there must be something else to show.
      camera: scene?.camera !== false || !STANDALONE_BACKGROUNDS.includes(background),
      flip: { x: scene?.flip?.x === true, y: scene?.flip?.y === true },
      background,
      effects: Array.isArray(scene?.effects) ? scene.effects.map(String) : [],
    };
  }

  const STARTERS = [
    { id: "starter-plain", name: "Plain camera" },
    { id: "starter-blur", name: "Blurred background", background: "blur" },
    { id: "starter-presenting", name: "Presenting", background: "display" },
    { id: "starter-privacy", name: "Privacy", background: "blur", effects: ["eye-bar"] },
  ];

  // Builds scenes from the settings used before scenes existed.
  function migrate(old = {}) {
    const source = old.source ?? "camera";
    const background = { keep: "room", blur: "blur", image: "image" }[old.background] ??
      (SOURCE_BACKGROUNDS.includes(old.background) ? old.background : "room");
    const fields = source === "camera"
      ? { camera: true, background }
      : { camera: false, background: SOURCE_BACKGROUNDS.includes(source) ? source : "room" };
    const filterId = old.activeFilterId ?? vw.DEFAULT_FILTER_ID ?? "distorted-tv";
    const current = createScene({
      id: "scene-my-setup",
      name: "My setup",
      ...fields,
      flip: { x: old.flipHorizontal === true, y: old.flipVertical === true },
      effects: filterId && filterId !== "none" ? [filterId] : [],
    });
    return {
      scenes: [current, ...STARTERS.map((starter) => createScene(starter))],
      activeSceneId: current.id,
    };
  }

  function activeScene(settings) {
    const scenes = Array.isArray(settings.scenes) ? settings.scenes : [];
    const scene = scenes.find((candidate) => candidate.id === settings.activeSceneId) ?? scenes[0];
    return normalizeScene(scene ?? {});
  }

  function describe(scene, nameOf = (id) => id) {
    const layers = !scene.camera ? ALONE[scene.background] : scene.background === "room" ? "Camera" : OVER[scene.background];
    const effects = scene.effects.map(nameOf).filter(Boolean);
    return effects.length ? `${layers} · ${effects.join(", ")}` : layers;
  }

  vw.scenes = {
    BACKGROUNDS,
    SOURCE_BACKGROUNDS,
    STANDALONE_BACKGROUNDS,
    STARTERS,
    createScene,
    normalizeScene,
    migrate,
    activeScene,
    describe,
  };
})();
