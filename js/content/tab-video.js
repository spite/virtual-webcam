(() => {
  const content = (globalThis.__virtualWebcamContent ??= { handlers: {} });
  const isTop = window === window.top;

  // Picks the largest visible video, preferring ones that are playing.
  content.findMainVideo = () => {
    let best = null;
    let bestScore = 0;
    for (const video of document.querySelectorAll("video")) {
      if (!video.videoWidth) continue;
      const rect = video.getBoundingClientRect();
      const width = Math.min(rect.right, innerWidth) - Math.max(rect.left, 0);
      const height = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0);
      const score = Math.max(0, width) * Math.max(0, height) * (video.paused ? 0.5 : 1);
      if (score > bestScore) {
        best = video;
        bestScore = score;
      }
    }
    return best;
  };

  // The video picture's area within the viewport, as fractions of the viewport.
  function videoRect(video) {
    const box = video.getBoundingClientRect();
    let { left: x, top: y, width: w, height: h } = box;
    const fit = getComputedStyle(video).objectFit;
    if (fit !== "fill" && fit !== "cover" && video.videoWidth && video.videoHeight) {
      const scale = Math.min(w / video.videoWidth, h / video.videoHeight);
      const fitted = fit === "none" ? 1 : fit === "scale-down" ? Math.min(scale, 1) : scale;
      const cw = video.videoWidth * fitted;
      const ch = video.videoHeight * fitted;
      x += (w - cw) / 2;
      y += (h - ch) / 2;
      w = cw;
      h = ch;
    }
    const left = Math.max(x, 0);
    const top = Math.max(y, 0);
    const right = Math.min(x + w, innerWidth);
    const bottom = Math.min(y + h, innerHeight);
    if (right - left < 2 || bottom - top < 2) return null;
    return {
      x: left / innerWidth,
      y: top / innerHeight,
      w: (right - left) / innerWidth,
      h: (bottom - top) / innerHeight,
    };
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "set-capture-handle" || !isTop) return;
    if (!document.querySelector("video")) return;
    try {
      navigator.mediaDevices.setCaptureHandleConfig?.({
        handle: message.handle,
        exposeOrigin: false,
        permittedOrigins: ["*"],
      });
    } catch {}
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "rect" || !isTop) return;
    let last = "";
    let lastSentAt = 0;
    const timer = setInterval(() => {
      const video = content.findMainVideo();
      const rect = video ? videoRect(video) : null;
      const json = JSON.stringify(rect);
      // Resends now and then so the background worker stays awake while the crop is in use.
      if (json === last && Date.now() - lastSentAt < 10000) return;
      last = json;
      lastSentAt = Date.now();
      port.postMessage({ rect });
    }, 250);
    port.onDisconnect.addListener(() => clearInterval(timer));
  });

  // Page-side requests from a tab that captures another tab.
  const watches = new Map();

  content.handlers["capture-handles"] = () => chrome.runtime.sendMessage({ type: "set-capture-handles" });

  content.handlers["rect-watch"] = async ({ watchId, handle }) => {
    const port = chrome.runtime.connect({ name: "rect" });
    watches.set(watchId, port);
    port.onMessage.addListener((message) => {
      if ("rect" in message) content.emit("rect", { watchId, rect: message.rect });
    });
    port.onDisconnect.addListener(() => watches.delete(watchId));
    port.postMessage({ handle });
    return true;
  };

  content.handlers["rect-unwatch"] = async ({ watchId }) => {
    watches.get(watchId)?.disconnect();
    watches.delete(watchId);
    return true;
  };
})();
