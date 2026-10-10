(() => {
  const vw = globalThis.__virtualWebcam;
  if (!vw) return;
  delete globalThis.__virtualWebcam;

  const settings = vw.extensionSettings ?? {
    ready: Promise.resolve(),
    current: () => ({
      virtualDefault: false,
      camera: true,
      flip: { x: false, y: false },
      background: "room",
      effects: [{ language: "glsl", source: vw.findFilter(vw.DEFAULT_FILTER_ID).source }],
      backgroundImage: null,
    }),
    onChange() {},
  };
  vw.monkeyPatchMediaDevices(settings);
})();
