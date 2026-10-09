// Request/response channel to the extension's content scripts, over DOM events.
(() => {
  const vw = (globalThis.__virtualWebcam ??= {});
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  const parse = (e) => {
    try {
      return JSON.parse(e.detail);
    } catch {
      return null;
    }
  };

  document.addEventListener("virtual-webcam:response", (e) => {
    const message = parse(e);
    const request = pending.get(message?.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) {
      request.resolve(message.result);
    } else {
      request.reject(new Error(message.error));
    }
  });

  document.addEventListener("virtual-webcam:event", (e) => {
    const message = parse(e);
    listeners.get(message?.channel)?.forEach((listener) => listener(message.data));
  });

  vw.extension = {
    request(type, data = {}, timeout = 10000) {
      const id = `${Date.now().toString(36)}-${nextId++}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`The extension didn't answer "${type}".`));
        }, timeout);
        pending.set(id, {
          resolve(value) {
            clearTimeout(timer);
            resolve(value);
          },
          reject(error) {
            clearTimeout(timer);
            reject(error);
          },
        });
        document.dispatchEvent(new CustomEvent("virtual-webcam:request", {
          detail: JSON.stringify({ id, type, data }),
        }));
      });
    },

    on(channel, listener) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(listener);
      return () => listeners.get(channel).delete(listener);
    },
  };
})();
