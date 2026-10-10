// Runs in a sandboxed extension page: the background and the chain of effects, one frame at a time.
(() => {
  const vw = globalThis.__virtualWebcam;
  const BASE = new URL("vendor/mediapipe/", location.href).href;
  const MODELS = {
    faceLandmarker: `${BASE}models/face_landmarker.task`,
    selfieSegmenter: `${BASE}models/selfie_segmenter_landscape.tflite`,
  };

  // The CSP keeps effects off the network; WebRTC isn't covered by it, so it's removed, along with child frames that would bring it back.
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

  // Each JavaScript effect gets its own helper, so its tasks can be closed when the effect is removed.
  function mediapipeFor(tasks) {
    return {
      vision: Vision,
      models: MODELS,
      fileset,
      timestamp,
      async faceLandmarker(options = {}) {
        const task = await createTask(Vision.FaceLandmarker, MODELS.faceLandmarker, options);
        tasks.push(task);
        return task;
      },
      async selfieSegmenter(options = {}) {
        const task = await createTask(Vision.ImageSegmenter, MODELS.selfieSegmenter, {
          outputConfidenceMasks: true,
          outputCategoryMask: false,
          ...options,
        });
        tasks.push(task);
        return task;
      },
    };
  }

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
    return out.canvas.transferToImageBitmap();
  }

  // JavaScript effects are loaded as blob scripts, so syntax and runtime errors report the effect's own line numbers.
  globalThis.__filterDefinitions = {};
  let loadCount = 0;

  function errorInfo(error, url) {
    const message = String(error?.message ?? error);
    const match = url && String(error?.stack ?? "").match(new RegExp(`${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+):\\d+`));
    return { line: match ? Number(match[1]) : null, message };
  }

  function loadScript(code) {
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
          reject({ line: null, message: "A JavaScript effect must define draw(frame, ctx, info)." });
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

  const stepKey = (effect) => `${effect.language}:${effect.source}`;

  async function createStep(effect) {
    if (effect.language === "glsl") {
      const renderer = new vw.ShaderRenderer(new OffscreenCanvas(1, 1));
      try {
        renderer.setShader(effect.source);
      } catch (e) {
        const first = e.errors?.[0];
        throw { line: first?.line ?? null, message: first?.message ?? e.message };
      }
      return { ...effect, renderer };
    }
    const definition = await loadScript(effect.source);
    const tasks = [];
    try {
      await definition.setup?.({ mediapipe: mediapipeFor(tasks) });
    } catch (e) {
      tasks.forEach((task) => task.close?.());
      throw errorInfo(e, definition.url);
    }
    return { ...effect, definition, tasks };
  }

  function disposeStep(step) {
    for (const task of step.tasks ?? []) {
      try {
        task.close();
      } catch {}
    }
  }

  let chain = [];
  let chainKey = "[]";
  let configureToken = 0;
  let frameIndex = 0;
  const lastDrawError = new Map();

  async function configure(next) {
    const token = ++configureToken;
    config.background = next.background;
    config.flip = next.flip;
    if (config.background !== "keep") getSegmenter().catch(() => {});

    const effects = (next.effects ?? []).map(({ language, source }) => ({ language, source }));
    const key = JSON.stringify(effects);
    if (key === chainKey) return [];

    // Effects already running are kept as they are; only new ones load.
    const pool = new Map();
    for (const step of chain) {
      if (!pool.has(stepKey(step))) pool.set(stepKey(step), []);
      pool.get(stepKey(step)).push(step);
    }
    const created = [];
    const nextChain = [];
    const errors = [];
    for (const [index, effect] of effects.entries()) {
      const reused = pool.get(stepKey(effect))?.shift();
      if (reused) {
        nextChain.push(reused);
        continue;
      }
      try {
        const step = await createStep(effect);
        created.push(step);
        nextChain.push(step);
      } catch (error) {
        errors.push({ index, line: error?.line ?? null, message: String(error?.message ?? error) });
      }
      if (token !== configureToken) {
        created.forEach(disposeStep);
        return [];
      }
    }
    for (const steps of pool.values()) steps.forEach(disposeStep);
    chain = nextChain;
    chainKey = key;
    return errors;
  }

  async function runStep(step, index, bitmap, width, height) {
    if (step.renderer) {
      step.renderer.setSize(width, height);
      step.renderer.render(bitmap);
      bitmap.close();
      return step.renderer.canvas.transferToImageBitmap();
    }
    const out = workCanvas(`effect-${index}`, width, height).ctx;
    out.reset?.();
    try {
      await step.definition.draw(bitmap, out, { time: timestamp(), width, height, frame: frameIndex });
    } catch (e) {
      if (Date.now() - (lastDrawError.get(step) ?? 0) > 2000) {
        lastDrawError.set(step, Date.now());
        reply({ type: "filter-error", phase: "draw", index, error: errorInfo(e, step.definition.url) });
      }
      out.reset?.();
      out.drawImage(bitmap, 0, 0, width, height);
    }
    bitmap.close();
    return out.canvas.transferToImageBitmap();
  }

  async function processFrame(bitmap, backgroundFrame) {
    const { width, height } = bitmap;
    let current = bitmap;
    if (config.flip.x || config.flip.y) {
      const flipped = workCanvas("flip", width, height).ctx;
      flipped.setTransform(config.flip.x ? -1 : 1, 0, 0, config.flip.y ? -1 : 1, config.flip.x ? width : 0, config.flip.y ? height : 0);
      flipped.drawImage(current, 0, 0);
      flipped.setTransform(1, 0, 0, 1, 0, 0);
      current.close();
      current = flipped.canvas.transferToImageBitmap();
    }
    if (config.background !== "keep") {
      const composite = await replaceBackground(current, width, height, backgroundFrame);
      current.close();
      current = composite;
    }
    for (const [index, step] of chain.entries()) {
      current = await runStep(step, index, current, width, height);
    }
    frameIndex++;
    return current;
  }

  addEventListener("message", async (e) => {
    if (e.source !== parent) return;
    const message = e.data;
    if (message?.type === "configure") {
      const errors = await configure(message.config);
      reply({ type: "configured", id: message.id, errors });
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
