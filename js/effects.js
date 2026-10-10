// Background effects and JavaScript filters, run by the sandboxed processor.
(() => {
  const vw = (globalThis.__virtualWebcam ??= {});
  const SOURCE_BACKGROUNDS = ["display", "tab-video", "file", "relay"];
  const MAX_IMAGE_SIDE = 1920;
  let processor = null;
  let imageVersion = null;

  // What the engine runs for a scene: the main source, a second source shown behind you, and the processing.
  function plan(settings) {
    const sourceBackground = SOURCE_BACKGROUNDS.includes(settings.background);
    const camera = settings.camera || !(sourceBackground || settings.background === "image");
    return {
      main: camera ? "camera" : settings.background,
      secondary: camera && sourceBackground ? settings.background : null,
      background: !camera || settings.background === "room" ? "keep" : sourceBackground ? "source" : settings.background,
      flip: camera ? settings.flip : { x: false, y: false },
      effects: settings.effects,
      backgroundImage: settings.backgroundImage,
    };
  }

  const needsProcessor = (plan) => plan.background !== "keep" || plan.effects.some((effect) => effect.language === "js");

  async function getProcessor() {
    if (!processor) {
      const { url } = await vw.extension.request("processor-url");
      processor = new vw.ProcessorClient(url);
      processor.onFilterError = (error, phase) => {
        console.warn(`Virtual webcam: the JavaScript filter failed in ${phase}()${error.line ? ` on line ${error.line}` : ""}: ${error.message}`);
      };
    }
    await processor.ready;
    return processor;
  }

  async function loadBackgroundImage() {
    const blob = await vw.receiveStoredFile("background-image");
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) return bitmap;
    const resized = await createImageBitmap(bitmap, {
      resizeWidth: Math.round(bitmap.width * scale),
      resizeHeight: Math.round(bitmap.height * scale),
      resizeQuality: "high",
    });
    bitmap.close();
    return resized;
  }

  // Returns the processor set up for this plan, or null when none is needed or it can't run here.
  async function sync(plan) {
    if (!needsProcessor(plan) || !vw.extension) return null;
    try {
      const client = await getProcessor();
      if (plan.background === "image" && plan.backgroundImage !== imageVersion) {
        imageVersion = plan.backgroundImage;
        let bitmap = null;
        try {
          bitmap = await loadBackgroundImage();
        } catch (e) {
          console.warn(`Virtual webcam: couldn't load the background image (${e.message}).`);
        }
        await client.setBackgroundImage(bitmap);
      }
      const errors = await client.configure({
        effects: plan.effects,
        background: plan.background,
        flip: plan.flip,
      });
      for (const error of errors ?? []) {
        console.warn(`Virtual webcam: effect ${error.index + 1} didn't load${error.line ? ` (line ${error.line})` : ""}: ${error.message}`);
      }
      return client;
    } catch (e) {
      console.warn(`Virtual webcam: background effects and JavaScript filters are unavailable here (${e.message}).`);
      return null;
    }
  }

  vw.effects = { plan, needsProcessor, sync, SOURCE_BACKGROUNDS };
})();
