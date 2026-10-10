// Runs in the extension's isolated world: forwards settings to the page world and answers its requests.
(() => {
  const content = (globalThis.__virtualWebcamContent ??= { handlers: {} });
  const DEFAULTS = {
    virtualDefault: false,
    scenes: [],
    activeSceneId: null,
    customFilters: [],
    builtinOverrides: {},
    backgroundImage: null,
  };
  const SETTINGS_EVENT = "virtual-webcam:settings";
  const REQUEST_EVENT = "virtual-webcam:request-settings";
  let settings;
  let lastSent;

  // Custom effects travel with their code; built-in ones by id, plus your edited version if there is one.
  function resolveEffect(id) {
    const custom = settings.customFilters.find((filter) => filter.id === id);
    if (custom) return { id, language: custom.language ?? "glsl", source: custom.source };
    return { id, builtin: true, source: settings.builtinOverrides[id]?.source ?? null };
  }

  const send = (force) => {
    const scene = globalThis.__virtualWebcam.scenes.activeScene(settings);
    const payload = JSON.stringify({
      virtualDefault: settings.virtualDefault,
      scene: { camera: scene.camera, flip: scene.flip, background: scene.background },
      effects: scene.effects.map(resolveEffect),
      backgroundImage: settings.backgroundImage?.updated ?? null,
    });
    if (!force && payload === lastSent) return;
    lastSent = payload;
    document.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: payload }));
  };

  document.addEventListener(REQUEST_EVENT, () => {
    if (settings) send(true);
  });

  chrome.storage.local.get(DEFAULTS).then((items) => {
    settings = items;
    send(true);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !settings) return;
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULTS) {
        settings[key] = change.newValue ?? DEFAULTS[key];
      }
    }
    send(false);
  });

  content.emit = (channel, data) => {
    document.dispatchEvent(new CustomEvent("virtual-webcam:event", { detail: JSON.stringify({ channel, data }) }));
  };

  content.requireCameraPermission = async () => {
    let state = "prompt";
    try {
      state = (await navigator.permissions.query({ name: "camera" })).state;
    } catch {}
    if (state !== "granted") throw new Error("The page needs camera permission.");
  };

  document.addEventListener("virtual-webcam:request", async (e) => {
    // A content script left behind by an extension reload stays silent so the current one answers.
    if (!chrome.runtime?.id) return;
    let message;
    try {
      message = JSON.parse(e.detail);
    } catch {
      return;
    }
    const handler = content.handlers[message?.type];
    if (!handler) return;
    let reply;
    try {
      reply = { id: message.id, ok: true, result: await handler(message.data ?? {}) };
    } catch (error) {
      reply = { id: message.id, ok: false, error: String(error?.message ?? error) };
    }
    document.dispatchEvent(new CustomEvent("virtual-webcam:response", { detail: JSON.stringify(reply) }));
  });

  // Pages may only reset the source to the camera, as offered after a source ends.
  content.handlers["set-source"] = async ({ source }) => {
    if (source !== "camera") throw new Error("Only the camera can be chosen from the page.");
    await chrome.storage.local.set({ source });
    return true;
  };

  content.handlers["file-token"] = async ({ key }) => {
    await content.requireCameraPermission();
    const token = await chrome.runtime.sendMessage({ type: "mint-file-token", key });
    return { token, url: chrome.runtime.getURL("source-frame.html") };
  };

  content.handlers["processor-url"] = async () => ({ url: chrome.runtime.getURL("processor.html") });
})();
