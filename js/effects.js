// Background effects and JavaScript filters, run by the sandboxed processor.
(() => {
  const vw = (globalThis.__virtualWebcam ??= {});
  const SOURCE_BACKGROUNDS = ["display", "tab-video", "file", "relay"];
  const MAX_IMAGE_SIDE = 1920;
  let processor = null;
  let imageVersion = null;

  const needsProcessor = (settings) => settings.filter.language === "js" || settings.background !== "keep";

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

  // Returns the processor set up for these settings, or null when none is needed or it can't run here.
  async function sync(settings) {
    if (!needsProcessor(settings) || !vw.extension) return null;
    try {
      const client = await getProcessor();
      if (settings.background === "image" && settings.backgroundImage !== imageVersion) {
        imageVersion = settings.backgroundImage;
        let bitmap = null;
        try {
          bitmap = await loadBackgroundImage();
        } catch (e) {
          console.warn(`Virtual webcam: couldn't load the background image (${e.message}).`);
        }
        await client.setBackgroundImage(bitmap);
      }
      const error = await client.configure({
        filter: settings.filter.language === "js" ? { code: settings.filter.source } : null,
        background: SOURCE_BACKGROUNDS.includes(settings.background) ? "source" : settings.background,
        flip: settings.flip,
      });
      if (error) {
        console.warn(`Virtual webcam: the JavaScript filter didn't load${error.line ? ` (line ${error.line})` : ""}: ${error.message}`);
      }
      return client;
    } catch (e) {
      console.warn(`Virtual webcam: background effects and JavaScript filters are unavailable here (${e.message}).`);
      return null;
    }
  }

  vw.effects = { needsProcessor, sync, SOURCE_BACKGROUNDS };
})();
