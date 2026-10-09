// Shares a video from this tab as a webcam: captures the tab restricted to the video, and serves it over WebRTC.
(() => {
  const content = (globalThis.__virtualWebcamContent ??= { handlers: {} });
  const isTop = window === window.top;
  const MAX_BITRATE = 8_000_000;

  let pointer = null;
  let share = null;
  let closeCurrentPanel = null;

  document.addEventListener("contextmenu", (e) => {
    pointer = {
      x: e.clientX,
      y: e.clientY,
      video: e.composedPath().find((node) => node instanceof HTMLVideoElement) ?? null,
    };
  }, true);

  function videoAtPointer() {
    if (!pointer) return null;
    if (pointer.video?.isConnected) return pointer.video;
    return document.elementsFromPoint(pointer.x, pointer.y).find((el) => el instanceof HTMLVideoElement) ?? null;
  }

  function closePanel() {
    closeCurrentPanel?.();
    closeCurrentPanel = null;
  }

  function showPanel(message, actions, anchor) {
    closePanel();
    closeCurrentPanel = content.showPanel(message, actions, anchor);
  }

  async function startShare(video) {
    closePanel();
    let track;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
      });
      track = stream.getVideoTracks()[0];
      if (track.getSettings().displaySurface !== "browser") {
        throw new Error("Share this tab, not a window or screen.");
      }
      if (!("RestrictionTarget" in window) || !track.restrictTo) {
        throw new Error("This browser can't capture a single element.");
      }
      if (getComputedStyle(video).isolation !== "isolate") video.style.isolation = "isolate";
      await track.restrictTo(await RestrictionTarget.fromElement(video));
    } catch (e) {
      track?.stop();
      if (e.name === "NotAllowedError") return;
      showPanel(`Couldn't share the video: ${e.message}`, [{ label: "Close", onClick: closePanel }], video);
      return;
    }

    track.contentHint = "motion";
    share = { video, track, connections: new Map() };
    track.addEventListener("ended", stopShare);
    chrome.runtime.sendMessage({ type: "relay-started", title: document.title }).catch(() => {});
    showSharingPanel();
  }

  function showSharingPanel() {
    showPanel("Sharing this video as your webcam. Right-click it again to stop.", [
      { label: "Hide", onClick: closePanel },
      { label: "Stop", primary: true, onClick: stopShare },
    ], share.video);
    const shown = closeCurrentPanel;
    setTimeout(() => {
      if (closeCurrentPanel === shown) closePanel();
    }, 6000);
  }

  function stopShare() {
    if (!share) return;
    const { track, connections } = share;
    share = null;
    track.stop();
    connections.forEach((pc) => pc.close());
    closePanel();
    chrome.runtime.sendMessage({ type: "relay-stopped" }).catch(() => {});
  }

  function iceComplete(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        if (pc.iceGatheringState !== "complete") return;
        pc.removeEventListener("icegatheringstatechange", done);
        resolve();
      };
      pc.addEventListener("icegatheringstatechange", done);
      setTimeout(resolve, 2000);
    });
  }

  async function answer(relayId, offer) {
    const pc = new RTCPeerConnection();
    share.connections.set(relayId, pc);
    pc.addEventListener("connectionstatechange", () => {
      if (["failed", "closed"].includes(pc.connectionState)) {
        pc.close();
        share?.connections.delete(relayId);
      }
    });
    const sender = pc.addTrack(share.track);
    await pc.setRemoteDescription(offer);
    await pc.setLocalDescription(await pc.createAnswer());
    const params = sender.getParameters();
    params.degradationPreference = "maintain-resolution";
    for (const encoding of params.encodings ?? []) encoding.maxBitrate = MAX_BITRATE;
    await sender.setParameters(params).catch(() => {});
    await iceComplete(pc);
    return pc.localDescription.toJSON();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "relay-arm") return;
    if (!isTop) {
      showPanel("Videos inside embedded frames can't be shared yet. Open the video in its own tab.", [
        { label: "Close", onClick: closePanel },
      ]);
      return;
    }
    const video = videoAtPointer() ?? content.findMainVideo?.();
    if (!video) {
      showPanel("There's no video here to share.", [{ label: "Close", onClick: closePanel }]);
      return;
    }
    if (share) {
      showSharingPanel();
      return;
    }
    showPanel("Use this video as your webcam? Chrome will ask to share this tab; only the video is sent.", [
      { label: "Cancel", onClick: closePanel },
      { label: "Share", primary: true, onClick: () => startShare(video) },
    ], video);
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "relay" || !isTop) return;
    port.onMessage.addListener(async (message) => {
      if (message.type === "offer") {
        if (!share) {
          port.postMessage({ type: "error", error: "This tab stopped sharing its video." });
          return;
        }
        try {
          port.postMessage({ type: "answer", relayId: message.relayId, answer: await answer(message.relayId, message.offer) });
        } catch (e) {
          port.postMessage({ type: "error", error: String(e?.message ?? e) });
        }
      } else if (message.type === "close") {
        share?.connections.get(message.relayId)?.close();
        share?.connections.delete(message.relayId);
      }
    });
  });

  // Page-side requests from a tab that receives the shared video.
  const relays = new Map();

  content.handlers["relay-connect"] = async ({ relayId, offer }) => {
    await content.requireCameraPermission();
    const port = chrome.runtime.connect({ name: "relay" });
    relays.set(relayId, port);
    port.onDisconnect.addListener(() => relays.delete(relayId));
    return new Promise((resolve, reject) => {
      port.onMessage.addListener((message) => {
        if (message.type === "answer" && message.relayId === relayId) resolve(message.answer);
        if (message.type === "error") reject(new Error(message.error));
      });
      port.onDisconnect.addListener(() => reject(new Error("The shared video isn't available.")));
      port.postMessage({ type: "offer", relayId, offer });
    });
  };

  content.handlers["relay-close"] = async ({ relayId }) => {
    const port = relays.get(relayId);
    if (port) {
      port.postMessage({ type: "close", relayId });
      port.disconnect();
      relays.delete(relayId);
    }
    return true;
  };
})();
