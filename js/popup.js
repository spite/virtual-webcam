const vw = globalThis.__virtualWebcam;
const $ = (id) => document.getElementById(id);
const DEFAULTS = { ...vw.SETTINGS_DEFAULTS, scenes: [], activeSceneId: null };

let settings = null;
let relaySource = null;

function filterName(id) {
  return settings.customFilters.find((filter) => filter.id === id)?.name ??
    vw.filters.find((filter) => filter.id === id)?.name;
}

function openStudio(hash = "") {
  chrome.tabs.create({ url: chrome.runtime.getURL(`studio.html${hash}`) });
  window.close();
}

// Points out anything the active scene needs that's missing.
function notice(scene) {
  if (scene.background === "file" && !settings.videoFile) return { text: "This scene uses a video file, but none is chosen.", action: "Choose one…" };
  if (scene.background === "image" && !settings.backgroundImage) return { text: "This scene uses an image, but none is chosen.", action: "Choose one…" };
  if (scene.background === "relay" && !relaySource) return { text: "Right-click a video in any tab and choose \"Use this video as webcam\" to share it." };
  if (scene.background === "relay") return { text: `Sharing: ${relaySource.title || "a tab"}` };
  if (["display", "tab-video"].includes(scene.background)) return { text: "Chrome asks what to share when the scene starts." };
  return null;
}

function render() {
  const list = $("scenes");
  list.replaceChildren();
  const active = vw.scenes.activeScene(settings);
  for (const raw of settings.scenes) {
    const scene = vw.scenes.normalizeScene(raw);
    const label = document.createElement("label");
    label.className = "scene";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "scene";
    input.checked = scene.id === active.id;
    input.addEventListener("change", () => chrome.storage.local.set({ activeSceneId: scene.id }));
    const text = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = scene.name;
    const summary = document.createElement("small");
    summary.textContent = vw.scenes.describe(scene, filterName);
    text.append(name, summary);
    label.append(input, text);
    list.append(label);
  }
  list.querySelector("input:checked")?.scrollIntoView({ block: "nearest" });

  const canTurnOff = vw.scenes.STANDALONE_BACKGROUNDS.includes(active.background);
  $("camera").checked = active.camera;
  $("camera").disabled = !canTurnOff;
  $("camera").parentElement.title = canTurnOff ? "" : "Pick a background in the Studio to turn the camera off.";
  $("mirror").checked = active.flip.x;
  $("mirror").disabled = !active.camera;

  const message = notice(active);
  const box = $("notice");
  box.hidden = !message;
  box.replaceChildren();
  if (message) {
    box.append(message.text);
    if (message.action) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "link";
      link.textContent = message.action;
      link.addEventListener("click", () => openStudio(`#scene=${encodeURIComponent(active.id)}`));
      box.append(" ", link);
    }
  }
}

function updateActiveScene(changes) {
  const active = vw.scenes.activeScene(settings);
  const scenes = settings.scenes.map((scene) => (scene.id === active.id ? vw.scenes.normalizeScene({ ...scene, ...changes }) : scene));
  chrome.storage.local.set({ scenes });
}

$("camera").addEventListener("change", () => updateActiveScene({ camera: $("camera").checked }));
$("mirror").addEventListener("change", () => {
  const active = vw.scenes.activeScene(settings);
  updateActiveScene({ flip: { ...active.flip, x: $("mirror").checked } });
});
$("virtual-default").addEventListener("change", () => {
  chrome.storage.local.set({ virtualDefault: $("virtual-default").checked });
});
$("studio").addEventListener("click", () => openStudio());

async function load() {
  settings = await chrome.storage.local.get(DEFAULTS);
  relaySource = (await chrome.storage.session.get({ relaySource: null })).relaySource;
  $("virtual-default").checked = settings.virtualDefault;
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") load();
});

load();
