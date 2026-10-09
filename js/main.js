(() => {
  const vw = globalThis.__virtualWebcam;
  if (!vw) return;
  delete globalThis.__virtualWebcam;

  const settings = vw.extensionSettings ?? {
    ready: Promise.resolve(),
    current: () => ({
      virtualDefault: false,
      filter: { language: "glsl", source: vw.findFilter(vw.DEFAULT_FILTER_ID).source },
      videoSource: "camera",
      flip: { x: false, y: false },
      background: "keep",
      backgroundImage: null,
    }),
    onChange() {},
  };
  vw.monkeyPatchMediaDevices(settings);
})();
