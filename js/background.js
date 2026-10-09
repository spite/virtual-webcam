const CONTENT_SCRIPTS = [
  "js/content/bridge.js",
  "js/content/panel.js",
  "js/content/tab-video.js",
  "js/content/relay-source.js",
];
const FILE_TOKEN_LIFETIME = 30000;

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: "use-video-as-webcam",
    title: "Use this video as webcam",
    contexts: ["video", "page"],
  });

  // Reconnects open tabs to the extension, since a reload or update cuts off their old content scripts.
  for (const tab of await chrome.tabs.query({})) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: CONTENT_SCRIPTS,
    }).catch(() => {});
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "use-video-as-webcam" || !tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "relay-arm" }, { frameId: info.frameId ?? 0 }).catch(() => {});
});

async function sessionGet(key, fallback) {
  return (await chrome.storage.session.get({ [key]: fallback }))[key];
}

async function clearRelaySource(tabId) {
  const relay = await sessionGet("relaySource", null);
  if (relay && relay.tabId === tabId) await chrome.storage.session.remove("relaySource");
}

chrome.tabs.onRemoved.addListener((tabId) => clearRelaySource(tabId));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") clearRelaySource(tabId);
});

const messageHandlers = {
  async "mint-file-token"(message, sender) {
    const token = crypto.randomUUID();
    const tokens = await sessionGet("fileTokens", {});
    const now = Date.now();
    for (const [key, value] of Object.entries(tokens)) {
      if (value.expires < now) delete tokens[key];
    }
    const key = message.key === "background-image" ? "background-image" : "video";
    tokens[token] = { tabId: sender.tab.id, key, expires: now + FILE_TOKEN_LIFETIME };
    await chrome.storage.session.set({ fileTokens: tokens });
    return token;
  },

  async "redeem-file-token"(message, sender) {
    const tokens = await sessionGet("fileTokens", {});
    const entry = tokens[message.token];
    if (!entry) return null;
    delete tokens[message.token];
    await chrome.storage.session.set({ fileTokens: tokens });
    return entry.tabId === sender.tab?.id && entry.expires > Date.now() ? entry.key : null;
  },

  async "set-capture-handles"(message, sender) {
    const handles = {};
    for (const tab of await chrome.tabs.query({})) {
      if (tab.id === sender.tab.id) continue;
      const handle = `virtual-webcam:${crypto.randomUUID()}`;
      handles[handle] = tab.id;
      chrome.tabs.sendMessage(tab.id, { type: "set-capture-handle", handle }, { frameId: 0 }).catch(() => {});
    }
    await chrome.storage.session.set({ captureHandles: handles });
    return true;
  },

  async "relay-started"(message, sender) {
    await chrome.storage.session.set({
      relaySource: { tabId: sender.tab.id, frameId: sender.frameId, title: message.title },
    });
    return true;
  },

  async "relay-stopped"(message, sender) {
    await clearRelaySource(sender.tab.id);
    return true;
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = messageHandlers[message?.type];
  if (!handler) return false;
  handler(message, sender).then(sendResponse, () => sendResponse(null));
  return true;
});

// Pipes a content-script port to a port in another tab, buffering until the target is known.
function pipe(port, findTarget) {
  const queue = [];
  let target = null;
  let closed = false;
  let resolveFirst;
  const firstMessage = new Promise((resolve) => (resolveFirst = resolve));

  const close = () => {
    if (closed) return;
    closed = true;
    port.disconnect();
    target?.disconnect();
    resolveFirst(null);
  };

  port.onMessage.addListener((message) => {
    if (target) {
      target.postMessage(message);
    } else {
      queue.push(message);
      resolveFirst(message);
    }
  });
  port.onDisconnect.addListener(close);

  findTarget(firstMessage).then((result) => {
    if (closed) return;
    if (result.error) {
      port.postMessage({ type: "error", error: result.error });
      close();
      return;
    }
    target = chrome.tabs.connect(result.tabId, { name: port.name, frameId: result.frameId ?? 0 });
    target.onMessage.addListener((message) => port.postMessage(message));
    target.onDisconnect.addListener(close);
    queue.forEach((message) => target.postMessage(message));
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "rect") {
    pipe(port, async (firstMessage) => {
      const first = await firstMessage;
      if (!first) return { error: "Closed." };
      const handles = await sessionGet("captureHandles", {});
      const tabId = handles[first.handle];
      return tabId ? { tabId } : { error: "Unknown tab." };
    });
  } else if (port.name === "relay") {
    pipe(port, async () => {
      const relay = await sessionGet("relaySource", null);
      return relay
        ? { tabId: relay.tabId, frameId: relay.frameId }
        : { error: 'No video is being shared. Right-click a video and choose "Use this video as webcam".' };
    });
  }
});
