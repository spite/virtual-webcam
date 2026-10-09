// Runs in a sandboxed extension page: background effects and JavaScript filters, one frame at a time.
(() => {
  const BASE = new URL("vendor/mediapipe/", location.href).href;
  const MODELS = {
    faceLandmarker: `${BASE}models/face_landmarker.task`,
    selfieSegmenter: `${BASE}models/selfie_segmenter_landscape.tflite`,
  };

  // The CSP keeps filters off the network; WebRTC isn't covered by it, so it's removed, along with child frames that would bring it back.
  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCIceTransport"]) {
    try {
      Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
    } catch {}
  }
  for (const proto of [HTMLIFrameElement.prototype, HTMLFrameElement.prototype, HTMLObjectElement.prototype]) {
    for (const property of ["contentWindow", "contentDocument"]) {
      try {
        Object.defineProperty(proto, property, { get: () => null, configurable: false });
      } catch {}
    }
  }
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLIFrameElement || node instanceof HTMLFrameElement || node instanceof HTMLObjectElement || node instanceof HTMLEmbedElement) {
          node.remove();
        }
      }
    }
  }).observe(document, { childList: true, subtree: true });

  const reply = (message, transfer = []) => parent.postMessage(message, "*", transfer);

  let lastTimestamp = 0;
  // MediaPipe's video mode needs strictly increasing timestamps.
  const timestamp = () => (lastTimestamp = Math.max(lastTimestamp + 1, Math.round(performance.now())));

  let filesetPromise = null;
  const fileset = () => (filesetPromise ??= Vision.FilesetResolver.forVisionTasks(`${BASE}wasm`));

  async function createTask(Task, modelAssetPath, options) {
    const files = await fileset();
    for (const delegate of ["GPU", "CPU"]) {
      try {
        return await Task.createFromOptions(files, {
          baseOptions: { modelAssetPath, delegate },
          runningMode: "VIDEO",
          ...options,
        });
      } catch (e) {
        if (delegate === "CPU") throw e;
      }
    }
  }

  let filterTasks = [];
  const mediapipe = {
    vision: Vision,
    models: MODELS,
    fileset,
    timestamp,
    async faceLandmarker(options = {}) {
      const task = await createTask(Vision.FaceLandmarker, MODELS.faceLandmarker, options);
      filterTasks.push(task);
      return task;
    },
    async selfieSegmenter(options = {}) {
      const task = await createTask(Vision.ImageSegmenter, MODELS.selfieSegmenter, {
        outputConfidenceMasks: true,
        outputCategoryMask: false,
        ...options,
      });
      filterTasks.push(task);
      return task;
    },
  };

  const canvases = new Map();
  function workCanvas(name, width, height) {
    let entry = canvases.get(name);
    if (!entry) {
      const canvas = new OffscreenCanvas(width, height);
      entry = { canvas, ctx: canvas.getContext("2d") };
      canvases.set(name, entry);
    }
    if (entry.canvas.width !== width || entry.canvas.height !== height) {
      entry.canvas.width = width;
      entry.canvas.height = height;
    }
    return entry;
  }

  const config = { background: "keep", flip: { x: false, y: false } };
  let backgroundImage = null;
  let segmenter = null;
  const getSegmenter = () => (segmenter ??= createTask(Vision.ImageSegmenter, MODELS.selfieSegmenter, {
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  }));

  function drawCover(ctx, image, width, height) {
    const scale = Math.max(width / image.width, height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  }

  function maskCanvas(mask) {
    const { width, height } = mask;
    const values = mask.getAsFloat32Array();
    const target = workCanvas("mask", width, height);
    if (!target.image || target.image.width !== width || target.image.height !== height) {
      target.image = target.ctx.createImageData(width, height);
    }
    const pixels = target.image.data;
    for (let i = 0; i < values.length; i++) {
      const t = Math.min(1, Math.max(0, (values[i] - 0.3) / 0.4));
      pixels[i * 4 + 3] = t * t * (3 - 2 * t) * 255;
    }
    target.ctx.putImageData(target.image, 0, 0);
    return target.canvas;
  }

  async function replaceBackground(picture, width, height, backgroundFrame) {
    const task = await getSegmenter();
    const result = task.segmentForVideo(picture, timestamp());
    const mask = maskCanvas(result.confidenceMasks[0]);
    result.close?.();

    const out = workCanvas("background", width, height).ctx;
    out.save();
    if (config.background === "blur") {
      const small = workCanvas("small", Math.max(1, width >> 3), Math.max(1, height >> 3));
      small.ctx.drawImage(picture, 0, 0, small.canvas.width, small.canvas.height);
      out.filter = "blur(6px)";
      out.drawImage(small.canvas, -16, -16, width + 32, height + 32);
    } else {
      const image = config.background === "image" ? backgroundImage : backgroundFrame;
      out.fillStyle = "#202124";
      out.fillRect(0, 0, width, height);
      if (image) drawCover(out, image, width, height);
    }
    out.restore();

    const person = workCanvas("person", width, height).ctx;
    person.save();
    person.globalCompositeOperation = "copy";
    person.drawImage(picture, 0, 0, width, height);
    person.globalCompositeOperation = "destination-in";
    person.drawImage(mask, 0, 0, width, height);
    person.restore();
    out.drawImage(person.canvas, 0, 0);
    return out.canvas;
  }

  // Filter code is loaded as a blob script, so syntax and runtime errors report the filter's own line numbers.
  globalThis.__filterDefinitions = {};
  let loadCount = 0;
  let filter = null;
  let filterCode = null;
  let configureToken = 0;
  let frameIndex = 0;
  let lastDrawError = 0;

  function errorInfo(error, url) {
    const message = String(error?.message ?? error);
    const match = url && String(error?.stack ?? "").match(new RegExp(`${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+):\\d+`));
    return { line: match ? Number(match[1]) : null, message };
  }

  function loadFilterCode(code) {
    return new Promise((resolve, reject) => {
      const key = `filter${++loadCount}`;
      const wrapped = `globalThis.__filterDefinitions[${JSON.stringify(key)}] = (() => {${code}\n;return { setup: typeof setup === "function" ? setup : null, draw: typeof draw === "function" ? draw : null };})();`;
      const url = URL.createObjectURL(new Blob([wrapped], { type: "text/javascript" }));
      let failure = null;
      const onError = (e) => {
        if (e.filename !== url) return;
        failure = { line: e.lineno || null, message: e.message.replace(/^Uncaught /, "") };
        e.preventDefault();
      };
      addEventListener("error", onError);
      const script = document.createElement("script");
      const done = () => {
        removeEventListener("error", onError);
        URL.revokeObjectURL(url);
        script.remove();
        const definition = globalThis.__filterDefinitions[key];
        delete globalThis.__filterDefinitions[key];
        if (failure) {
          reject(failure);
        } else if (!definition?.draw) {
          reject({ line: null, message: "A JavaScript filter must define draw(frame, ctx, info)." });
        } else {
          resolve({ ...definition, url });
        }
      };
      script.onload = done;
      script.onerror = done;
      script.src = url;
      document.head.append(script);
    });
  }

  function disposeFilter() {
    filter = null;
    for (const task of filterTasks) {
      try {
        task.close();
      } catch {}
    }
    filterTasks = [];
  }

  async function runFilter(picture, width, height) {
    const frame = picture instanceof ImageBitmap ? picture : picture.transferToImageBitmap();
    const out = workCanvas("filter", width, height).ctx;
    out.reset?.();
    try {
      await filter.draw(frame, out, { time: timestamp(), width, height, frame: frameIndex++ });
    } catch (e) {
      if (Date.now() - lastDrawError > 2000) {
        lastDrawError = Date.now();
        reply({ type: "filter-error", phase: "draw", error: errorInfo(e, filter.url) });
      }
      out.reset?.();
      out.drawImage(frame, 0, 0, width, height);
    }
    frame.close();
    return out.canvas;
  }

  async function configure(next) {
    const token = ++configureToken;
    config.background = next.background;
    config.flip = next.flip;
    if (config.background !== "keep") getSegmenter().catch(() => {});

    const code = next.filter?.code ?? null;
    if (code === filterCode) return null;
    filterCode = code;
    disposeFilter();
    if (code === null) return null;
    try {
      const definition = await loadFilterCode(code);
      if (token !== configureToken) return null;
      try {
        await definition.setup?.({ mediapipe });
      } catch (e) {
        throw errorInfo(e, definition.url);
      }
      if (token === configureToken) filter = definition;
      return null;
    } catch (error) {
      if (token === configureToken) filterCode = null;
      return error;
    }
  }

  async function processFrame(bitmap, backgroundFrame) {
    const { width, height } = bitmap;
    let picture = bitmap;
    if (config.flip.x || config.flip.y) {
      const flipped = workCanvas("flip", width, height).ctx;
      flipped.setTransform(config.flip.x ? -1 : 1, 0, 0, config.flip.y ? -1 : 1, config.flip.x ? width : 0, config.flip.y ? height : 0);
      flipped.drawImage(bitmap, 0, 0);
      flipped.setTransform(1, 0, 0, 1, 0, 0);
      picture = flipped.canvas;
    }
    if (config.background !== "keep") {
      picture = await replaceBackground(picture, width, height, backgroundFrame);
    }
    if (filter) {
      picture = await runFilter(picture, width, height);
    }
    if (picture === bitmap) return bitmap;
    bitmap.close();
    return picture.transferToImageBitmap();
  }

  addEventListener("message", async (e) => {
    if (e.source !== parent) return;
    const message = e.data;
    if (message?.type === "configure") {
      const error = await configure(message.config);
      reply({ type: "configured", id: message.id, error });
    } else if (message?.type === "background-image") {
      backgroundImage?.close();
      backgroundImage = message.bitmap ?? null;
      reply({ type: "background-image", id: message.id });
    } else if (message?.type === "frame") {
      try {
        const bitmap = await processFrame(message.bitmap, message.background);
        reply({ type: "frame", id: message.id, bitmap }, [bitmap]);
      } catch (error) {
        reply({ type: "frame", id: message.id, error: String(error?.message ?? error) });
      } finally {
        message.background?.close();
      }
    }
  });

  reply({ type: "ready" });
})();
