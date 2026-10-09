const vw = globalThis.__virtualWebcam;
const toggle = document.getElementById("virtual-default");
const list = document.getElementById("filters");

function renderFilters(customFilters, activeFilterId) {
  const all = [...vw.filters, ...customFilters];
  const activeId = all.some((filter) => filter.id === activeFilterId)
    ? activeFilterId
    : vw.DEFAULT_FILTER_ID;

  list.replaceChildren();
  const group = (title, filters) => {
    if (!filters.length) return;
    const heading = document.createElement("h3");
    heading.textContent = title;
    list.append(heading);
    for (const filter of filters) {
      const label = document.createElement("label");
      label.className = "filter";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "filter";
      input.value = filter.id;
      input.checked = filter.id === activeId;
      input.addEventListener("change", () => {
        chrome.storage.local.set({ activeFilterId: filter.id });
      });
      const name = document.createElement("span");
      name.textContent = filter.name;
      label.append(input, name);
      if (filter.language === "js") {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "JS";
        tag.title = "JavaScript filter";
        label.append(tag);
      }
      list.append(label);
    }
  };
  group("Custom", customFilters);
  group("Built-in", vw.filters);
  list.querySelector("input:checked")?.scrollIntoView({ block: "nearest" });
}

function formatSize(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

chrome.storage.local.get(vw.SETTINGS_DEFAULTS).then((settings) => {
  const { virtualDefault, activeFilterId, customFilters, source, videoFile } = settings;
  toggle.checked = virtualDefault;
  document.getElementById("flip-horizontal").checked = settings.flipHorizontal;
  document.getElementById("flip-vertical").checked = settings.flipVertical;
  renderFilters(customFilters, activeFilterId);
  for (const input of document.querySelectorAll("input[name=source]")) {
    input.checked = input.value === source;
  }
  if (videoFile) {
    document.getElementById("file-status").textContent = `${videoFile.name} (${formatSize(videoFile.size)})`;
    document.getElementById("choose-file").textContent = "Change…";
  }
});

chrome.storage.session.get({ relaySource: null }).then(({ relaySource }) => {
  if (relaySource) {
    document.getElementById("relay-status").textContent = `Sharing: ${relaySource.title || "a tab"}`;
  }
});

function renderBackground(background, backgroundImage) {
  document.getElementById("background").value = background;
  const chooser = document.getElementById("choose-image");
  chooser.hidden = background !== "image";
  chooser.textContent = backgroundImage ? "Change…" : "Choose…";
  const hint = document.getElementById("background-hint");
  hint.textContent = backgroundImage?.name ?? "No image chosen yet.";
  hint.hidden = background !== "image";
}

chrome.storage.local.get(vw.SETTINGS_DEFAULTS).then(({ background, backgroundImage }) => {
  renderBackground(background, backgroundImage);
  const select = document.getElementById("background");
  select.addEventListener("change", () => {
    chrome.storage.local.set({ background: select.value });
    renderBackground(select.value, backgroundImage);
  });
});

document.getElementById("choose-image").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("video.html?image") });
  window.close();
});

for (const input of document.querySelectorAll("input[name=source]")) {
  input.addEventListener("change", () => chrome.storage.local.set({ source: input.value }));
}

document.getElementById("choose-file").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("video.html") });
  window.close();
});

for (const [id, key] of [["flip-horizontal", "flipHorizontal"], ["flip-vertical", "flipVertical"]]) {
  const input = document.getElementById(id);
  input.addEventListener("change", () => chrome.storage.local.set({ [key]: input.checked }));
}

toggle.addEventListener("change", () => {
  chrome.storage.local.set({ virtualDefault: toggle.checked });
});

document.getElementById("edit").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
