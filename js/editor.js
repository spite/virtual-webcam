const vw = globalThis.__virtualWebcam;
const $ = (id) => document.getElementById(id);

const TEMPLATES = {
  glsl: `// iChannel0 is the camera. See "Writing a filter" for the other inputs.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 color = texture(iChannel0, uv).rgb;
  fragColor = vec4(color, 1.0);
}
`,
  js: `// Runs once when the filter loads. See "Writing a filter" for what's available.
async function setup({ mediapipe }) {
}

// Runs for every frame: draw the output onto ctx.
function draw(frame, ctx, { time, width, height }) {
  ctx.drawImage(frame, 0, 0, width, height);
}
`,
};

const sourceInput = $("source");
const gutter = $("gutter");

let customFilters = [];
let builtinOverrides = {};
// The Studio's Scenes tab owns the selected scene; the editor adds effects to it.
const sceneEffects = () => globalThis.studio?.selectedScene()?.effects ?? [];
let selectedId = vw.DEFAULT_FILTER_ID;
let errorLines = new Set();

const findCustom = (id) => customFilters.find((filter) => filter.id === id);
const findAny = (id) => findCustom(id) ?? vw.filters.find((filter) => filter.id === id);

let saveTimer;
function saveFilters() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.local.set({ customFilters, builtinOverrides }), 300);
}

const languageOf = (id) => findAny(id)?.language ?? "glsl";

function addCustomFilter(name, source, language = "glsl") {
  const filter = { id: `custom-${crypto.randomUUID()}`, name, language, source, draft: source };
  customFilters.push(filter);
  chrome.storage.local.set({ customFilters });
  select(filter.id);
  return filter;
}

function addToScene(id) {
  globalThis.studio?.addEffect(id);
  renderList();
  renderToolbar();
}

function renderList() {
  const list = $("filter-list");
  list.replaceChildren();
  const group = (title, filters) => {
    if (!filters.length) return;
    const heading = document.createElement("h2");
    heading.textContent = title;
    list.append(heading);
    for (const filter of filters) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "filter-item";
      item.setAttribute("aria-current", String(filter.id === selectedId));
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = filter.name;
      item.append(name);
      if (filter.language === "js") {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "JS";
        tag.title = "JavaScript filter";
        item.append(tag);
      }
      if (builtinOverrides[filter.id] && !findCustom(filter.id)) {
        const edited = document.createElement("span");
        edited.className = "edited";
        edited.textContent = "edited";
        item.append(edited);
      }
      if (sceneEffects().includes(filter.id)) {
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.title = "In the selected scene";
        item.append(dot);
      }
      item.addEventListener("click", () => select(filter.id));
      list.append(item);
    }
  };
  group("Custom", customFilters);
  group("Built-in", vw.filters);
}

function renderToolbar() {
  const custom = Boolean(findCustom(selectedId));
  const edited = !custom && Boolean(builtinOverrides[selectedId]);
  const inUse = sceneEffects().includes(selectedId);
  $("name").readOnly = !custom;
  $("delete").hidden = !custom;
  $("reset").hidden = !edited;
  $("builtin-note").hidden = custom;
  $("builtin-note").textContent = edited
    ? "Edited built-in filter. Apps use your version until you reset it."
    : "Built-in filter. Edits are saved as your own version, and you can reset to the original at any time.";
  $("in-use").hidden = !inUse;
  $("use").disabled = inUse;
  const js = languageOf(selectedId) === "js";
  $("language").textContent = js ? "JavaScript" : "GLSL shader";
  $("reference-glsl").hidden = js;
  $("reference-js").hidden = !js;
}

function select(id) {
  const filter = findAny(id) ?? vw.findFilter(vw.DEFAULT_FILTER_ID);
  selectedId = filter.id;
  const custom = findCustom(filter.id);
  const override = custom ? null : builtinOverrides[filter.id];
  const saved = custom ?? override;
  sourceInput.value = saved ? saved.draft ?? saved.source : filter.source;
  sourceInput.scrollTop = 0;
  $("name").value = filter.name;
  renderList();
  renderToolbar();
  compile();
}

function renderGutter() {
  const count = sourceInput.value.split("\n").length;
  const lines = [];
  for (let i = 1; i <= count; i++) {
    const line = document.createElement("span");
    line.textContent = i;
    if (errorLines.has(i)) line.className = "error";
    lines.push(line);
  }
  gutter.replaceChildren(...lines);
  gutter.scrollTop = sourceInput.scrollTop;
}

function goToLine(line) {
  const lines = sourceInput.value.split("\n");
  const start = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0);
  sourceInput.focus();
  sourceInput.setSelectionRange(start, start + lines[line - 1].length);
  const lineHeight = parseFloat(getComputedStyle(sourceInput).lineHeight);
  sourceInput.scrollTop = Math.max(0, (line - 1) * lineHeight - sourceInput.clientHeight / 3);
}

function showErrors(errors, { pending = false, unavailable = null } = {}) {
  const lineCount = sourceInput.value.split("\n").length;
  const status = $("status");
  const list = $("errors");
  errorLines = new Set();
  list.replaceChildren();

  if (unavailable) {
    status.textContent = unavailable;
    status.className = "status failed";
  } else if (pending) {
    status.textContent = "Loading…";
    status.className = "status";
  } else if (!errors.length) {
    status.textContent = languageOf(selectedId) === "js" ? "Loaded." : "Compiled.";
    status.className = "status";
  } else {
    status.textContent = errors.length === 1 ? "1 error" : `${errors.length} errors`;
    status.className = "status failed";
  }

  for (const { line, message } of errors) {
    const known = line !== null && line <= lineCount;
    if (known) errorLines.add(line);
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = known ? `Line ${line}: ${message}` : message;
    if (known) button.addEventListener("click", () => goToLine(line));
    item.append(button);
    list.append(item);
  }
  renderGutter();
}

// JavaScript filters run in the same sandboxed processor that pages use.
let processor = null;
function getProcessor() {
  if (!processor) {
    processor = new vw.ProcessorClient(chrome.runtime.getURL("processor.html"));
    processor.onFilterError = (error, phase) => {
      if (languageOf(selectedId) !== "js") return;
      showErrors([{ line: error.line, message: `${phase}(): ${error.message}` }]);
    };
  }
  return processor;
}

let compileToken = 0;
async function compile() {
  const token = ++compileToken;
  const text = sourceInput.value;
  const language = languageOf(selectedId);
  let errors = [];
  if (language === "js") {
    renderer?.setShader(vw.PASSTHROUGH_SHADER);
    showErrors([], { pending: true });
    try {
      const error = await getProcessor().configure({ filter: { code: text }, background: "keep", flip: { x: false, y: false } });
      if (error) errors = [error];
    } catch (e) {
      if (token === compileToken) showErrors([], { unavailable: `Can't run JavaScript filters here (${e.message}).` });
      return;
    }
    if (token !== compileToken) return;
    showErrors(errors);
  } else {
    if (processor) processor.configure({ filter: null, background: "keep", flip: { x: false, y: false } }).catch(() => {});
    if (renderer) {
      try {
        renderer.setShader(text);
      } catch (e) {
        if (!(e instanceof vw.ShaderError)) throw e;
        errors = e.errors.length ? e.errors : [{ line: null, message: e.log || e.message }];
      }
    }
    showErrors(errors, { unavailable: renderer ? null : "Can't check the shader: WebGL2 isn't available." });
  }

  const custom = findCustom(selectedId);
  if (custom) {
    if (custom.draft !== text || (!errors.length && custom.source !== text)) {
      custom.draft = text;
      if (!errors.length) custom.source = text;
      saveFilters();
    }
    return;
  }

  const original = vw.filters.find((filter) => filter.id === selectedId).source;
  const override = builtinOverrides[selectedId];
  if (text === original) {
    if (!override) return;
    delete builtinOverrides[selectedId];
  } else if (!override || override.draft !== text || (!errors.length && override.source !== text)) {
    builtinOverrides[selectedId] = {
      draft: text,
      source: errors.length ? override?.source ?? original : text,
    };
  } else {
    return;
  }
  saveFilters();
  renderList();
  renderToolbar();
}

let compileTimer;
sourceInput.addEventListener("input", () => {
  renderGutter();
  clearTimeout(compileTimer);
  compileTimer = setTimeout(compile, 250);
});

sourceInput.addEventListener("scroll", () => {
  gutter.scrollTop = sourceInput.scrollTop;
});

sourceInput.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || sourceInput.readOnly || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  sourceInput.setRangeText("  ", sourceInput.selectionStart, sourceInput.selectionEnd, "end");
  sourceInput.dispatchEvent(new Event("input"));
});

$("name").addEventListener("input", () => {
  const custom = findCustom(selectedId);
  if (!custom) return;
  custom.name = $("name").value.trim() || "Untitled";
  saveFilters();
  renderList();
});

$("new").addEventListener("click", () => {
  addCustomFilter("Untitled", TEMPLATES.glsl);
  $("name").select();
});

$("new-js").addEventListener("click", () => {
  addCustomFilter("Untitled", TEMPLATES.js, "js");
  $("name").select();
});

$("duplicate").addEventListener("click", () => {
  const filter = findAny(selectedId);
  addCustomFilter(`${filter.name} copy`, sourceInput.value, languageOf(selectedId));
});

$("use").addEventListener("click", () => addToScene(selectedId));

$("reset").addEventListener("click", () => {
  const filter = findAny(selectedId);
  if (!confirm(`Reset "${filter.name}" to the original? Your edits will be lost.`)) return;
  delete builtinOverrides[selectedId];
  chrome.storage.local.set({ builtinOverrides });
  select(selectedId);
});

$("delete").addEventListener("click", () => {
  const custom = findCustom(selectedId);
  if (!custom || !confirm(`Delete "${custom.name}"? This can't be undone.`)) return;
  customFilters = customFilters.filter((filter) => filter !== custom);
  chrome.storage.local.set({ customFilters });
  globalThis.studio?.removeEffectEverywhere(custom.id);
  select(customFilters[0]?.id ?? vw.DEFAULT_FILTER_ID);
});

$("export").addEventListener("click", () => {
  const filter = findAny(selectedId);
  const slug = filter.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "filter";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([sourceInput.value], { type: "text/plain" }));
  link.download = `${slug}.${languageOf(selectedId) === "js" ? "js" : "glsl"}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (e) => {
  for (const file of e.target.files) {
    const language = /\.(m?js)$/i.test(file.name) ? "js" : "glsl";
    addCustomFilter(file.name.replace(/\.[^.]+$/, ""), await file.text(), language);
  }
  e.target.value = "";
});

window.addEventListener("pagehide", () => {
  clearTimeout(saveTimer);
  chrome.storage.local.set({ customFilters, builtinOverrides });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.scenes || changes.activeSceneId)) {
    renderList();
    renderToolbar();
  }
});

// Preview

const canvas = $("preview");
const previewStatus = $("preview-status");
let renderer = null;
try {
  renderer = new vw.ShaderRenderer(canvas);
} catch (e) {
  previewStatus.textContent = "Preview unavailable: WebGL2 isn't supported here.";
}

const pattern = vw.testPattern.canvas;
const drawPattern = (time) => vw.testPattern.draw(time);

let previewMode = "pattern";
let video = null;
let videoFileUrl = null;

function stopVideo() {
  video?.srcObject?.getTracks().forEach((track) => track.stop());
  video?.pause();
  if (videoFileUrl) URL.revokeObjectURL(videoFileUrl);
  videoFileUrl = null;
  video = null;
}

async function openPreviewVideo(mode) {
  const element = document.createElement("video");
  element.muted = true;
  element.playsInline = true;
  if (mode === "camera") {
    element.srcObject = await navigator.mediaDevices.getUserMedia({ video: true });
  } else {
    const file = await vw.videoStore.get();
    if (!file) throw new Error("No video file has been chosen");
    videoFileUrl = URL.createObjectURL(file);
    element.loop = true;
    element.src = videoFileUrl;
  }
  return element;
}

const mirrorInput = $("mirror");
try {
  mirrorInput.checked = localStorage.getItem("mirrorPreview") !== "false";
} catch {}

function updateMirror() {
  $("mirror-option").hidden = previewMode !== "camera";
  canvas.classList.toggle("mirrored", previewMode === "camera" && mirrorInput.checked);
}

mirrorInput.addEventListener("change", () => {
  try {
    localStorage.setItem("mirrorPreview", String(mirrorInput.checked));
  } catch {}
  updateMirror();
});

function showPreviewMode(mode) {
  previewMode = mode;
  for (const button of document.querySelectorAll("[data-preview]")) {
    button.setAttribute("aria-pressed", String(button.dataset.preview === mode));
  }
  updateMirror();
}

async function setPreviewMode(mode) {
  stopVideo();
  showPreviewMode(mode);
  previewStatus.textContent = "";
  if (mode === "pattern") return;
  try {
    const element = await openPreviewVideo(mode);
    if (previewMode !== mode) {
      element.srcObject?.getTracks().forEach((track) => track.stop());
      return;
    }
    video = element;
    await video.play();
  } catch (e) {
    stopVideo();
    showPreviewMode("pattern");
    const what = mode === "camera" ? "the camera" : "the video file";
    previewStatus.textContent = `Couldn't open ${what} (${e.name === "Error" ? e.message : e.name}). Showing the test pattern.`;
  }
}

for (const button of document.querySelectorAll("[data-preview]")) {
  button.addEventListener("click", () => setPreviewMode(button.dataset.preview));
}

let jsBusy = false;
let jsLatest = null;

function previewSource() {
  if (previewMode === "pattern") {
    drawPattern(performance.now() / 1000);
    return pattern;
  }
  return video?.videoWidth ? video : null;
}

function renderPreview() {
  requestAnimationFrame(renderPreview);
  if (!renderer || $("effects-view")?.hidden) return;
  const source = previewSource();
  if (!source) return;
  if (languageOf(selectedId) !== "js") {
    renderer.setSize(source.videoWidth || source.width, source.videoHeight || source.height);
    renderer.render(source);
    return;
  }
  if (!jsBusy && processor) {
    jsBusy = true;
    createImageBitmap(source)
      .then((bitmap) => processor.process(bitmap))
      .then((bitmap) => {
        jsLatest?.close();
        jsLatest = bitmap;
      })
      .catch(() => {})
      .finally(() => {
        jsBusy = false;
      });
  }
  if (jsLatest) {
    renderer.setSize(jsLatest.width, jsLatest.height);
    renderer.render(jsLatest);
  }
}

// Video file preview

function renderVideoFile(videoFile) {
  const button = document.querySelector("[data-preview=file]");
  button.disabled = !videoFile;
  button.title = videoFile ? videoFile.name : "Choose a video file in a scene's background first";
  if (!videoFile && previewMode === "file") setPreviewMode("pattern");
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.videoFile) {
    renderVideoFile(changes.videoFile.newValue ?? null);
    if (previewMode === "file") setPreviewMode("file");
  }
});

chrome.storage.local.get(vw.SETTINGS_DEFAULTS).then((settings) => {
  renderVideoFile(settings.videoFile);
  customFilters = settings.customFilters;
  builtinOverrides = settings.builtinOverrides;
  const first = sceneEffects().find((id) => findAny(id));
  select(first ?? vw.DEFAULT_FILTER_ID);
  requestAnimationFrame(renderPreview);
});
