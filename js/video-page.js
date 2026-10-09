const vw = globalThis.__virtualWebcam;
const $ = (id) => document.getElementById(id);

// The same page manages the video file (video.html) and the background image (video.html?image).
const MODES = {
  video: {
    title: "Video file",
    intro: "Used as the webcam when the popup's source is \"Video file\". It loops, without sound, and the selected filter is applied on top.",
    kind: "video",
    noun: "video",
    storeKey: "video",
    metaKey: "videoFile",
    settingKey: "source",
    settingValue: "file",
    settingOff: "camera",
    use: "Use this video as the webcam source",
    saved: "Saved. The webcam source is now this video.",
    removed: "Removed. The webcam source is back to the camera.",
  },
  image: {
    title: "Background image",
    intro: "Shown behind you when the popup's background is \"Image\". Your camera picture is cut out and placed over it.",
    kind: "image",
    noun: "image",
    storeKey: "background-image",
    metaKey: "backgroundImage",
    settingKey: "background",
    settingValue: "image",
    settingOff: "keep",
    use: "Use this image as the background",
    saved: "Saved. The background is now this image.",
    removed: "Removed. The background is back to your real one.",
  },
};
const mode = MODES[location.search === "?image" ? "image" : "video"];
const preview = $(mode.kind === "image" ? "image-preview" : "preview");
let previewUrl = null;

document.title = `Virtual Webcam ${mode.title}`;
$("heading").textContent = mode.title;
$("intro").textContent = mode.intro;
$("empty-text").textContent = `No ${mode.noun} chosen.`;
$("empty-hint").textContent = `Drop ${mode.noun === "image" ? "an image" : "a video"} here, or choose one.`;
$("input").accept = `${mode.kind}/*`;
$("use-label").textContent = mode.use;

function formatSize(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").className = isError ? "status error" : "status";
}

async function render(settings) {
  const meta = settings[mode.metaKey];
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  const file = meta ? await vw.videoStore.get(mode.storeKey) : null;
  if (file) {
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    preview.play?.().catch(() => {});
  } else {
    preview.removeAttribute("src");
  }
  preview.hidden = !file;
  $("empty").hidden = Boolean(file);
  $("file-name").textContent = file ? `${meta.name} (${formatSize(meta.size)})` : "";
  $("file-name").title = file ? meta.name : "";
  $("choose").textContent = file ? "Replace…" : `Choose ${mode.noun}…`;
  $("remove").hidden = !file;
  $("use-row").hidden = !file;
  $("use").checked = settings[mode.settingKey] === mode.settingValue;
}

async function save(file) {
  if (!file.type.startsWith(`${mode.kind}/`)) {
    setStatus(`${file.name} isn't ${mode.noun === "image" ? "an image" : "a video"}.`, true);
    return;
  }
  setStatus(`Saving ${file.name}…`);
  try {
    await vw.videoStore.put(file, mode.storeKey);
  } catch (e) {
    setStatus(`Couldn't save the file (${e?.name ?? e}).`, true);
    return;
  }
  const meta = { name: file.name, size: file.size, type: file.type, updated: Date.now() };
  await chrome.storage.local.set({ [mode.metaKey]: meta, [mode.settingKey]: mode.settingValue });
  setStatus(mode.saved);
}

$("choose").addEventListener("click", () => $("input").click());

$("input").addEventListener("change", (e) => {
  const [file] = e.target.files;
  e.target.value = "";
  if (file) save(file);
});

$("remove").addEventListener("click", async () => {
  if (!confirm(`Remove the ${mode.noun}?`)) return;
  await vw.videoStore.delete(mode.storeKey);
  const settings = await chrome.storage.local.get(vw.SETTINGS_DEFAULTS);
  const inUse = settings[mode.settingKey] === mode.settingValue;
  await chrome.storage.local.set({ [mode.metaKey]: null, ...(inUse ? { [mode.settingKey]: mode.settingOff } : {}) });
  setStatus(inUse ? mode.removed : "Removed.");
});

$("use").addEventListener("change", () => {
  chrome.storage.local.set({ [mode.settingKey]: $("use").checked ? mode.settingValue : mode.settingOff });
});

const drop = $("drop");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("dragging");
});
drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("dragging");
  const [file] = e.dataTransfer.files;
  if (file) save(file);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(changes[mode.metaKey] || changes[mode.settingKey])) return;
  chrome.storage.local.get(vw.SETTINGS_DEFAULTS).then(render);
});

chrome.storage.local.get(vw.SETTINGS_DEFAULTS).then(render);
