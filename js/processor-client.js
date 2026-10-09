// Talks to the sandboxed processor page, embedded as an invisible frame.
(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  class ProcessorClient {
    constructor(url) {
      this.pending = new Map();
      this.nextId = 1;
      this.lastConfig = null;
      this.lastResult = null;
      this.onFilterError = null;
      this.ready = this.load(url);
      this.ready.catch(() => {});
    }

    load(url) {
      return new Promise((resolve, reject) => {
        const frame = document.createElement("iframe");
        Object.assign(frame.style, {
          position: "fixed",
          left: "-10px",
          top: "-10px",
          width: "1px",
          height: "1px",
          border: "0",
          opacity: "0",
          pointerEvents: "none",
        });
        frame.setAttribute("aria-hidden", "true");
        frame.tabIndex = -1;
        frame.src = url;
        const timer = setTimeout(() => reject(new Error("The filter processor didn't load.")), 15000);
        this.onMessage = (e) => {
          if (e.source !== frame.contentWindow) return;
          const message = e.data;
          if (message?.type === "ready") {
            clearTimeout(timer);
            resolve();
          } else if (message?.type === "filter-error") {
            this.onFilterError?.(message.error, message.phase);
          } else {
            const settle = this.pending.get(message?.id);
            if (settle) {
              this.pending.delete(message.id);
              settle(message);
            }
          }
        };
        addEventListener("message", this.onMessage);
        this.frame = frame;
        (document.body ?? document.documentElement).append(frame);
      });
    }

    async send(message, transfer = []) {
      await this.ready;
      const id = this.nextId++;
      return new Promise((resolve) => {
        this.pending.set(id, resolve);
        this.frame.contentWindow.postMessage({ ...message, id }, "*", transfer);
      });
    }

    // Resolves with null, or { line, message } when the filter fails to load.
    configure(config) {
      const key = JSON.stringify(config);
      if (key !== this.lastConfig) {
        this.lastConfig = key;
        this.lastResult = this.send({ type: "configure", config }).then((reply) => reply.error ?? null);
      }
      return this.lastResult;
    }

    async process(bitmap, background) {
      const transfer = background ? [bitmap, background] : [bitmap];
      const reply = await this.send({ type: "frame", bitmap, background }, transfer);
      if (reply.error) throw new Error(reply.error);
      return reply.bitmap;
    }

    async setBackgroundImage(bitmap) {
      await this.send({ type: "background-image", bitmap }, bitmap ? [bitmap] : []);
    }

    destroy() {
      removeEventListener("message", this.onMessage);
      this.frame?.remove();
    }
  }

  vw.ProcessorClient = ProcessorClient;
})();
