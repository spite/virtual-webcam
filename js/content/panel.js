// A small floating panel in the page, isolated from its styles.
(() => {
  const content = (globalThis.__virtualWebcamContent ??= { handlers: {} });

  content.showPanel = (message, actions, anchor) => {
    const panel = document.createElement("virtual-webcam-panel");
    const root = panel.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      .panel {
        position: fixed;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: min(420px, calc(100vw - 32px));
        padding: 10px 12px;
        border-radius: 10px;
        background: #1f2024;
        color: #ececf1;
        font: 13px/1.35 system-ui, sans-serif;
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
      }
      .text { flex: 1; }
      button {
        padding: 5px 12px;
        border: 1px solid #3a3b40;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      button.primary { border-color: #5aa7f0; background: #5aa7f0; color: #0b1520; font-weight: 600; }
      button:focus-visible { outline: 2px solid #5aa7f0; outline-offset: 1px; }
    `;
    const box = document.createElement("div");
    box.className = "panel";
    box.setAttribute("role", "dialog");
    const text = document.createElement("div");
    text.className = "text";
    text.textContent = message;
    box.append(text);
    for (const { label, primary, onClick } of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (primary) button.className = "primary";
      button.addEventListener("click", onClick);
      box.append(button);
    }
    const rect = anchor?.getBoundingClientRect();
    const top = rect ? Math.min(Math.max(rect.top + 12, 12), innerHeight - 80) : 16;
    const left = rect ? Math.min(Math.max(rect.left + 12, 12), innerWidth - 300) : 16;
    box.style.top = `${top}px`;
    box.style.left = `${left}px`;
    root.append(style, box);
    document.documentElement.append(panel);
    box.querySelector("button.primary, button")?.focus();
    return () => panel.remove();
  };

  // Resolves with `value` when the source setting changes elsewhere, so a stale prompt goes away.
  function closeOnSourceChange(finish, value) {
    const listener = (changes, area) => {
      if (area === "local" && changes.source) finish(value);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  content.handlers["share-prompt"] = ({ kind, purpose }) => new Promise((resolve) => {
    let close = null;
    let unlisten = null;
    const finish = (value) => {
      clearTimeout(timer);
      unlisten?.();
      close?.();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), 110000);
    unlisten = closeOnSourceChange(finish, false);
    const use = purpose === "background" ? "your background" : "your webcam";
    const message = kind === "tab"
      ? `Choose the tab with the video to use as ${use}.`
      : `Choose a tab, window or screen to use as ${use}.`;
    close = content.showPanel(message, [
      { label: "Not now", onClick: () => finish(false) },
      { label: "Choose…", primary: true, onClick: () => finish(true) },
    ]);
  });

  const SOURCE_NAMES = {
    camera: "camera",
    display: "shared tab or window",
    "tab-video": "video from the tab",
    file: "video file",
    relay: "shared video",
  };

  content.handlers["source-ended"] = ({ kind }) => new Promise((resolve) => {
    let close = null;
    let unlisten = null;
    const finish = (value) => {
      clearTimeout(timer);
      unlisten?.();
      close?.();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 110000);
    unlisten = closeOnSourceChange(finish, null);
    const picker = kind === "display" || kind === "tab-video";
    close = content.showPanel(`Your webcam's ${SOURCE_NAMES[kind] ?? "source"} ended.`, [
      { label: "Dismiss", onClick: () => finish(null) },
      ...(picker ? [{ label: "Choose again…", onClick: () => finish("again") }] : []),
      { label: "Use camera", primary: true, onClick: () => finish("camera") },
    ]);
  });
})();
