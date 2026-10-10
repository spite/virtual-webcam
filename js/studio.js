// The Studio's Scenes tab: build scenes from layers (you, a background, effects), with a live preview.
(() => {
  const vw = globalThis.__virtualWebcam;
  const $ = (id) => document.getElementById(id);
  const { SOURCE_BACKGROUNDS, STANDALONE_BACKGROUNDS } = vw.scenes;

  const BACKGROUND_OPTIONS = [
    { value: "room", label: "Your room", needsCamera: true },
    { value: "blur", label: "Blurred room", needsCamera: true },
    { value: "image", label: "Image", media: "image" },
    { value: "display", label: "Tab, window or screen", detail: "Chrome asks which one when the scene starts." },
    { value: "tab-video", label: "Video in a tab", detail: "Pick a tab when the scene starts; only its video is shown." },
    { value: "file", label: "Video file", media: "video" },
    { value: "relay", label: "Shared video" },
  ];
  const MEDIA = {
    image: { key: "background-image", meta: "backgroundImage", input: "image-input", noun: "image" },
    video: { key: "video", meta: "videoFile", input: "video-input", noun: "video" },
  };

  let settings = null;
  let selectedSceneId = new URLSearchParams(location.hash.slice(1)).get("scene");
  let relaySource = null;

  const allScenes = () => (settings?.scenes ?? []).map(vw.scenes.normalizeScene);
  const selectedScene = () => {
    const scenes = allScenes();
    return scenes.find((scene) => scene.id === selectedSceneId) ?? scenes[0] ?? null;
  };
  const findEffect = (id) => settings.customFilters.find((filter) => filter.id === id) ?? vw.filters.find((filter) => filter.id === id);
  const effectName = (id) => findEffect(id)?.name;

  function resolveEffect(id) {
    const custom = settings.customFilters.find((filter) => filter.id === id);
    if (custom) return { language: custom.language ?? "glsl", source: custom.source };
    const builtin = vw.filters.find((filter) => filter.id === id);
    if (!builtin) return null;
    return { language: builtin.language, source: settings.builtinOverrides[id]?.source ?? builtin.source };
  }

  function saveScenes(scenes) {
    settings.scenes = scenes;
    chrome.storage.local.set({ scenes });
  }

  function updateScene(changes) {
    const id = selectedScene().id;
    saveScenes(settings.scenes.map((scene) => (scene.id === id ? vw.scenes.normalizeScene({ ...scene, ...changes }) : scene)));
    render();
  }

  // Scene list and toolbar

  function renderSceneList() {
    const list = $("scene-list");
    list.replaceChildren();
    const selected = selectedScene();
    for (const scene of allScenes()) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "filter-item scene-item";
      item.setAttribute("aria-current", String(scene.id === selected?.id));
      const text = document.createElement("span");
      text.className = "text";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = scene.name;
      const summary = document.createElement("small");
      summary.textContent = vw.scenes.describe(scene, effectName);
      text.append(name, summary);
      item.append(text);
      if (scene.id === settings.activeSceneId) {
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.title = "Active";
        item.append(dot);
      }
      item.addEventListener("click", () => {
        selectedSceneId = scene.id;
        render();
      });
      list.append(item);
    }
  }

  function renderToolbar(scene) {
    if (document.activeElement !== $("scene-name")) $("scene-name").value = scene.name;
    const active = scene.id === settings.activeSceneId;
    $("scene-active").hidden = !active;
    $("activate-scene").disabled = active;
    $("delete-scene").disabled = settings.scenes.length < 2;
  }

  // Layers

  function renderYou(scene) {
    const canTurnOff = STANDALONE_BACKGROUNDS.includes(scene.background);
    $("layer-camera").checked = scene.camera;
    $("layer-camera").disabled = scene.camera && !canTurnOff;
    $("camera-note").hidden = !(scene.camera && !canTurnOff);
    $("layer-mirror").checked = scene.flip.x;
    $("layer-upside-down").checked = scene.flip.y;
    $("layer-mirror").disabled = !scene.camera;
    $("layer-upside-down").disabled = !scene.camera;
  }

  function mediaRow(kind) {
    const media = MEDIA[kind];
    const meta = settings[media.meta];
    const row = document.createElement("div");
    row.className = "media";
    if (meta && kind === "image" && thumbnails.image) {
      const img = document.createElement("img");
      img.src = thumbnails.image;
      img.alt = "";
      row.append(img);
    }
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = meta ? meta.name : `No ${media.noun} chosen yet.`;
    name.title = meta?.name ?? "";
    const choose = document.createElement("button");
    choose.type = "button";
    choose.textContent = meta ? "Change…" : "Choose…";
    choose.addEventListener("click", () => $(media.input).click());
    row.append(name, choose);
    if (meta) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => removeMedia(kind));
      row.append(remove);
    }
    return row;
  }

  function renderBackground(scene) {
    const box = $("background-options");
    box.replaceChildren();
    for (const option of BACKGROUND_OPTIONS) {
      const label = document.createElement("label");
      label.className = "option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "background";
      input.value = option.value;
      input.checked = scene.background === option.value;
      input.disabled = option.needsCamera && !scene.camera;
      input.addEventListener("change", () => {
        updateScene({ background: option.value });
        if (option.media && !settings[MEDIA[option.media].meta]) $(MEDIA[option.media].input).click();
      });
      const text = document.createElement("span");
      text.className = "text";
      const name = document.createElement("span");
      name.textContent = option.label;
      text.append(name);
      let detail = option.detail;
      if (option.value === "relay") {
        detail = relaySource ? `Sharing: ${relaySource.title || "a tab"}` : "Right-click a video in any tab and choose \"Use this video as webcam\".";
      }
      if (option.needsCamera && !scene.camera) detail = "Needs the camera on.";
      if (detail) {
        const small = document.createElement("small");
        small.textContent = detail;
        text.append(small);
      }
      if (option.media && scene.background === option.value) text.append(mediaRow(option.media));
      label.append(input, text);
      box.append(label);
    }
  }

  function renderEffects(scene) {
    const list = $("effect-list");
    list.replaceChildren();
    if (!scene.effects.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "No effects";
      list.append(empty);
    }
    scene.effects.forEach((id, index) => {
      const effect = findEffect(id);
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.className = effect ? "name" : "name missing";
      name.textContent = effect ? effect.name : "Missing effect";
      item.append(name);
      if (effect?.language === "js") {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "JS";
        item.append(tag);
      }
      const button = (text, label, onClick, disabled = false) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.setAttribute("aria-label", `${label} ${effect?.name ?? "effect"}`);
        b.title = label;
        b.disabled = disabled;
        b.addEventListener("click", onClick);
        item.append(b);
      };
      const move = (delta) => {
        const effects = [...scene.effects];
        [effects[index], effects[index + delta]] = [effects[index + delta], effects[index]];
        updateScene({ effects });
      };
      button("↑", "Move up", () => move(-1), index === 0);
      button("↓", "Move down", () => move(1), index === scene.effects.length - 1);
      if (effect) button("Edit", "Edit", () => editEffect(id));
      button("✕", "Remove", () => updateScene({ effects: scene.effects.filter((_, i) => i !== index) }));
      list.append(item);
    });

    const select = $("add-effect");
    select.replaceChildren();
    const placeholder = new Option("+ Add effect…", "");
    select.append(placeholder);
    const group = (label, filters) => {
      if (!filters.length) return;
      const optgroup = document.createElement("optgroup");
      optgroup.label = label;
      for (const filter of filters) optgroup.append(new Option(filter.language === "js" ? `${filter.name} (JS)` : filter.name, filter.id));
      select.append(optgroup);
    };
    group("Custom", settings.customFilters);
    group("Built-in", vw.filters.filter((filter) => filter.id !== "none"));
    select.value = "";
  }

  function render() {
    if (!settings) return;
    const scene = selectedScene();
    if (!scene) return;
    selectedSceneId = scene.id;
    renderSceneList();
    renderToolbar(scene);
    renderYou(scene);
    renderBackground(scene);
    renderEffects(scene);
    $("preview-live").hidden = !["display", "tab-video"].includes(scene.background);
  }

  // Media files

  const thumbnails = { image: null };

  async function refreshThumbnail() {
    if (thumbnails.image) URL.revokeObjectURL(thumbnails.image);
    thumbnails.image = null;
    if (!settings.backgroundImage) return;
    const file = await vw.videoStore.get("background-image");
    if (file) thumbnails.image = URL.createObjectURL(file);
  }

  async function saveMedia(kind, file) {
    const media = MEDIA[kind];
    if (!file.type.startsWith(`${kind}/`)) {
      $("scene-status").textContent = `${file.name} isn't ${kind === "image" ? "an image" : "a video"}.`;
      return;
    }
    $("scene-status").textContent = `Saving ${file.name}…`;
    try {
      await vw.videoStore.put(file, media.key);
    } catch (e) {
      $("scene-status").textContent = `Couldn't save ${file.name} (${e?.name ?? e}).`;
      return;
    }
    await chrome.storage.local.set({ [media.meta]: { name: file.name, size: file.size, type: file.type, updated: Date.now() } });
    $("scene-status").textContent = "";
  }

  async function removeMedia(kind) {
    const media = MEDIA[kind];
    if (!confirm(`Remove the ${media.noun}? Scenes that use it won't have a ${media.noun} until you choose another.`)) return;
    await vw.videoStore.delete(media.key);
    await chrome.storage.local.set({ [media.meta]: null });
  }

  for (const kind of Object.keys(MEDIA)) {
    $(MEDIA[kind].input).addEventListener("change", (e) => {
      const [file] = e.target.files;
      e.target.value = "";
      if (file) saveMedia(kind, file);
    });
  }

  // Actions

  $("new-scene").addEventListener("click", () => {
    const scene = vw.scenes.createScene({ name: "New scene" });
    saveScenes([...settings.scenes, scene]);
    selectedSceneId = scene.id;
    render();
    $("scene-name").select();
  });

  $("duplicate-scene").addEventListener("click", () => {
    const source = selectedScene();
    const scene = vw.scenes.createScene({ ...source, id: undefined, name: `${source.name} copy` });
    saveScenes([...settings.scenes, scene]);
    selectedSceneId = scene.id;
    render();
  });

  $("delete-scene").addEventListener("click", () => {
    const scene = selectedScene();
    if (settings.scenes.length < 2 || !confirm(`Delete "${scene.name}"? This can't be undone.`)) return;
    const scenes = settings.scenes.filter((candidate) => candidate.id !== scene.id);
    saveScenes(scenes);
    if (settings.activeSceneId === scene.id) chrome.storage.local.set({ activeSceneId: scenes[0].id });
    selectedSceneId = scenes[0].id;
    render();
  });

  $("activate-scene").addEventListener("click", () => {
    settings.activeSceneId = selectedScene().id;
    chrome.storage.local.set({ activeSceneId: settings.activeSceneId });
    render();
  });

  $("scene-name").addEventListener("input", () => updateScene({ name: $("scene-name").value.trim() || "Untitled scene" }));
  $("layer-camera").addEventListener("change", () => updateScene({ camera: $("layer-camera").checked }));
  $("layer-mirror").addEventListener("change", () => updateScene({ flip: { ...selectedScene().flip, x: $("layer-mirror").checked } }));
  $("layer-upside-down").addEventListener("change", () => updateScene({ flip: { ...selectedScene().flip, y: $("layer-upside-down").checked } }));

  $("add-effect").addEventListener("change", () => {
    const id = $("add-effect").value;
    if (id) updateScene({ effects: [...selectedScene().effects, id] });
  });

  // Tabs

  function showTab(name) {
    const effects = name === "effects";
    $("tab-scenes").setAttribute("aria-selected", String(!effects));
    $("tab-effects").setAttribute("aria-selected", String(effects));
    $("scenes-view").hidden = effects;
    $("effects-view").hidden = !effects;
    // The Effects tab's functions are globals from editor.js.
    if (effects) {
      window.renderList();
      window.renderToolbar();
    }
  }

  function editEffect(id) {
    showTab("effects");
    window.select(id);
  }

  $("tab-scenes").addEventListener("click", () => showTab("scenes"));
  $("tab-effects").addEventListener("click", () => showTab("effects"));

  globalThis.studio = {
    selectedScene,
    addEffect(id) {
      updateScene({ effects: [...selectedScene().effects, id] });
    },
    removeEffectEverywhere(id) {
      saveScenes(settings.scenes.map((scene) => ({ ...scene, effects: (scene.effects ?? []).filter((effect) => effect !== id) })));
      render();
    },
  };

  // Preview: the same sandboxed processor that calls use, fed with a test pattern or your camera.

  const canvas = $("scene-canvas");
  const context = canvas.getContext("2d");
  const status = $("scene-status");
  let processor = null;
  let cameraMode = "pattern";
  let cameraVideo = null;
  let fileVideo = null;
  let fileVersion = null;
  let imageBitmap = null;
  let imageVersion = null;
  let live = null;
  let busy = false;

  const placeholderCanvas = document.createElement("canvas");
  placeholderCanvas.width = 1280;
  placeholderCanvas.height = 720;
  function placeholder(title, subtitle) {
    const ctx = placeholderCanvas.getContext("2d");
    ctx.fillStyle = "#2a2d34";
    ctx.fillRect(0, 0, 1280, 720);
    ctx.strokeStyle = "#4a4f5a";
    ctx.lineWidth = 4;
    ctx.setLineDash([24, 16]);
    ctx.strokeRect(40, 40, 1200, 640);
    ctx.fillStyle = "#e8eaed";
    ctx.textAlign = "center";
    ctx.font = "600 52px system-ui, sans-serif";
    ctx.fillText(title, 640, 350);
    ctx.fillStyle = "#9aa0a6";
    ctx.font = "32px system-ui, sans-serif";
    ctx.fillText(subtitle, 640, 410);
    return placeholderCanvas;
  }

  async function syncMedia(scene) {
    const fileMeta = settings.videoFile?.updated ?? settings.videoFile?.name ?? null;
    if (scene.background === "file" && fileMeta !== fileVersion) {
      fileVersion = fileMeta;
      fileVideo?.pause();
      if (fileVideo?.src) URL.revokeObjectURL(fileVideo.src);
      fileVideo = null;
      const file = settings.videoFile ? await vw.videoStore.get("video") : null;
      if (file) {
        fileVideo = document.createElement("video");
        fileVideo.muted = true;
        fileVideo.loop = true;
        fileVideo.playsInline = true;
        fileVideo.src = URL.createObjectURL(file);
        fileVideo.play().catch(() => {});
      }
    }
    const imageMeta = settings.backgroundImage?.updated ?? null;
    if (scene.background === "image" && imageMeta !== imageVersion) {
      imageVersion = imageMeta;
      imageBitmap?.close();
      imageBitmap = null;
      const file = settings.backgroundImage ? await vw.videoStore.get("background-image") : null;
      if (file) imageBitmap = await createImageBitmap(file);
      await getProcessor().setBackgroundImage(imageBitmap ? await createImageBitmap(imageBitmap) : null);
    }
  }

  function backgroundSource(scene) {
    switch (scene.background) {
      case "image":
        return imageBitmap ?? placeholder("No image chosen", "Choose one under Background");
      case "file":
        return fileVideo?.videoWidth ? fileVideo : placeholder("No video file chosen", "Choose one under Background");
      case "display":
      case "tab-video":
        if (live?.kind === scene.background && live.video.videoWidth) return live.video;
        return placeholder(
          scene.background === "display" ? "Your tab, window or screen" : "The video in a tab",
          "appears here. Use \"Preview live\" to see it.",
        );
      case "relay":
        return placeholder("The shared video", relaySource ? `Sharing: ${relaySource.title || "a tab"}` : "Right-click a video in any tab to share it");
      default:
        return null;
    }
  }

  function cameraSource() {
    return cameraMode === "camera" && cameraVideo?.videoWidth ? cameraVideo : vw.testPattern.draw();
  }

  function getProcessor() {
    processor ??= new vw.ProcessorClient(chrome.runtime.getURL("processor.html"));
    return processor;
  }

  async function renderFrame() {
    const scene = selectedScene();
    if (!scene) return;
    await syncMedia(scene);
    const background = !scene.camera || scene.background === "room"
      ? "keep"
      : SOURCE_BACKGROUNDS.includes(scene.background) ? "source" : scene.background;
    const effects = scene.effects.map(resolveEffect).filter(Boolean);
    const errors = await getProcessor().configure({ effects, background, flip: scene.camera ? scene.flip : { x: false, y: false } });
    const loaded = scene.effects.filter((id) => resolveEffect(id));
    status.textContent = errors.length
      ? errors.map((error) => `${effectName(loaded[error.index]) ?? `Effect ${error.index + 1}`} didn't load${error.line ? ` (line ${error.line})` : ""}: ${error.message}`).join(" ")
      : status.textContent.startsWith("Saving") || status.textContent.startsWith("Couldn't") ? status.textContent : "";

    const input = await createImageBitmap(scene.camera ? cameraSource() : backgroundSource(scene));
    const behind = background === "source" ? await createImageBitmap(backgroundSource(scene)) : null;
    const output = await getProcessor().process(input, behind);
    if (canvas.width !== output.width || canvas.height !== output.height) {
      canvas.width = output.width;
      canvas.height = output.height;
    }
    context.drawImage(output, 0, 0);
    output.close();
  }

  function tick() {
    requestAnimationFrame(tick);
    if (busy || !settings || $("scenes-view").hidden) return;
    busy = true;
    renderFrame()
      .catch((e) => {
        status.textContent = `Preview unavailable (${e.message}).`;
      })
      .finally(() => {
        busy = false;
      });
  }

  for (const button of document.querySelectorAll("[data-camera]")) {
    button.addEventListener("click", async () => {
      const mode = button.dataset.camera;
      for (const other of document.querySelectorAll("[data-camera]")) other.setAttribute("aria-pressed", String(other === button));
      cameraMode = mode;
      cameraVideo?.srcObject?.getTracks().forEach((track) => track.stop());
      cameraVideo = null;
      if (mode !== "camera") return;
      try {
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = await navigator.mediaDevices.getUserMedia({ video: true });
        await video.play();
        cameraVideo = video;
      } catch (e) {
        status.textContent = `Couldn't open the camera (${e.name}). Showing the test pattern.`;
        cameraMode = "pattern";
        for (const other of document.querySelectorAll("[data-camera]")) other.setAttribute("aria-pressed", String(other.dataset.camera === "pattern"));
      }
    });
  }

  $("preview-live").addEventListener("click", async () => {
    const kind = selectedScene().background;
    live?.video.srcObject?.getTracks().forEach((track) => track.stop());
    live = null;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: kind === "tab-video" ? { displaySurface: "browser" } : true,
        audio: false,
      });
      const video = document.createElement("video");
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      live = { kind, video };
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        if (live?.video === video) live = null;
      });
    } catch (e) {
      if (e.name !== "NotAllowedError") status.textContent = `Couldn't start the live preview (${e.name}).`;
    }
  });

  // Loading

  async function load() {
    settings = await chrome.storage.local.get(vw.SETTINGS_DEFAULTS);
    if (!settings.scenes.length) {
      const migrated = vw.scenes.migrate(settings);
      Object.assign(settings, migrated);
      await chrome.storage.local.set(migrated);
    }
    relaySource = (await chrome.storage.session.get({ relaySource: null })).relaySource;
    await refreshThumbnail();
    render();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") load();
    if (area === "session" && changes.relaySource) {
      relaySource = changes.relaySource.newValue ?? null;
      render();
    }
  });

  const hash = new URLSearchParams(location.hash.slice(1));
  load().then(() => {
    if (hash.get("effect")) editEffect(hash.get("effect"));
    requestAnimationFrame(tick);
  });
})();
